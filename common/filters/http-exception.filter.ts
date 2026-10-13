import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LoggingService } from '../logging/logging.service.js';
import { RequestContextService } from '../logging/request-context.service.js';
import { redact } from '../logging/logging-redaction.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly loggingService: LoggingService;
  private readonly requestContextService?: RequestContextService;

  constructor(
    @Optional() loggingService?: LoggingService,
    @Optional() requestContextService?: RequestContextService,
  ) {
    this.loggingService = loggingService ?? new LoggingService();
    this.requestContextService = requestContextService;
  }

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';

    // 1. If it's a direct HttpException (NestJS guards, controllers, pipes)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorCode = this.statusToCode(status);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const errorResponse = exceptionResponse as any;
        if (Array.isArray(errorResponse.message)) {
          message = errorResponse.message.join('; ');
        } else if (typeof errorResponse.message === 'string') {
          message = errorResponse.message;
        }
        errorCode =
          errorResponse.error?.toUpperCase().replace(/ /g, '_') ??
          this.statusToCode(status);
      }
    }
    // 2. If it's an error forwarded from Core (success: false, error: {...})
    else if (exception?.success === false && exception?.error) {
      status = exception.statusCode || HttpStatus.BAD_REQUEST;

      if (exception.error.code === 'UNAUTHORIZED') status = HttpStatus.UNAUTHORIZED;
      else if (exception.error.code === 'NOT_FOUND') status = HttpStatus.NOT_FOUND;
      else if (exception.error.code === 'FORBIDDEN') status = HttpStatus.FORBIDDEN;

      errorCode = exception.error.code;
      message = exception.error.message;
    }

    const requestId =
      this.requestContextService?.getRequestId() ||
      (response.getHeader('X-Request-Id') as string) ||
      undefined;

    // Log at warn for expected client errors (4xx), error for server failures (5xx)
    const isClientError = status < HttpStatus.INTERNAL_SERVER_ERROR;
    const sanitizedPath = (request.originalUrl || request.url || '').split('?')[0];

    if (isClientError) {
      this.loggingService.warn(
        `HTTP ${status} [${errorCode}]: ${message} (${request.method} ${sanitizedPath})`,
        'HttpExceptionFilter',
        {
          status,
          errorCode,
          path: sanitizedPath,
          method: request.method,
        },
      );
    } else {
      const stack = exception instanceof Error ? exception.stack : undefined;
      const errorName = exception instanceof Error ? exception.name : 'ServerError';

      this.loggingService.error(
        `HTTP ${status} [${errorCode}]: ${message} (${request.method} ${sanitizedPath})`,
        stack,
        'HttpExceptionFilter',
        {
          status,
          errorCode,
          path: sanitizedPath,
          method: request.method,
          errorName,
          details: redact(exception?.details || exception?.meta),
        },
      );
    }

    // Never leak internal stack traces or database errors in public client responses
    const clientMessage =
      status >= HttpStatus.INTERNAL_SERVER_ERROR && process.env.NODE_ENV === 'production'
        ? 'An unexpected internal server error occurred'
        : message;

    response.status(status).json({
      success: false,
      error: {
        code: errorCode,
        message: clientMessage,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
