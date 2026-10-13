import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { LoggingService } from './logging.service.js';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  private readonly logHealthCheck: boolean;
  private readonly logRequestBody: boolean;
  private readonly logResponseBody: boolean;

  constructor(
    private readonly logger: LoggingService,
    private readonly configService: ConfigService,
  ) {
    this.enabled =
      (this.configService.get<string>('LOG_HTTP_REQUESTS') ?? 'true') === 'true';

    this.logHealthCheck =
      (this.configService.get<string>('LOG_HEALTH_CHECK') ?? 'false') === 'true';

    this.logRequestBody =
      (this.configService.get<string>('LOG_HTTP_REQUEST_BODY') ?? 'false') === 'true';

    this.logResponseBody =
      (this.configService.get<string>('LOG_HTTP_RESPONSE_BODY') ?? 'false') === 'true';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const path = this.sanitizePath(req.originalUrl || req.url || '');

    // Skip health check logging unless configured
    if (!this.logHealthCheck && this.isHealthCheck(path)) {
      return next.handle();
    }

    const startTime = Date.now();
    const method = req.method;

    // Debug-level log for incoming request
    this.logger.debug(`--> HTTP ${method} ${path}`, 'HttpLogging', {
      method,
      path,
      ip: req.ip || req.socket.remoteAddress,
      ...(this.logRequestBody && req.body ? { body: req.body } : {}),
    });

    return next.handle().pipe(
      tap((responseBody) => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode || 200;

        this.logger.log(
          `<-- HTTP ${method} ${path} ${statusCode} [${durationMs}ms]`,
          'HttpLogging',
          {
            method,
            path,
            statusCode,
            durationMs,
            ...(this.logResponseBody && responseBody ? { response: responseBody } : {}),
          },
        );
      }),
      catchError((error) => {
        const durationMs = Date.now() - startTime;
        const statusCode =
          error?.status ?? error?.statusCode ?? res.statusCode ?? 500;

        // Log request completion as failure without duplicating full exception stack trace
        this.logger.warn(
          `<-- HTTP ${method} ${path} ${statusCode} [${durationMs}ms] (failed: ${error?.name || 'Error'})`,
          'HttpLogging',
          {
            method,
            path,
            statusCode,
            durationMs,
            errorName: error?.name,
          },
        );

        return throwError(() => error);
      }),
    );
  }

  private sanitizePath(rawUrl: string): string {
    // Strip query string parameters to prevent leaking sensitive query parameters
    const queryIndex = rawUrl.indexOf('?');
    return queryIndex !== -1 ? rawUrl.substring(0, queryIndex) : rawUrl;
  }

  private isHealthCheck(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.includes('healthcheck') || lower.includes('/health');
  }
}
