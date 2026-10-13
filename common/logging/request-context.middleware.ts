import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestContextData, RequestContextService } from './request-context.service.js';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.requestContextService.extractRequestId(req.headers);
    const traceId = this.requestContextService.extractTraceId(req.headers);

    // Expose validated/generated request ID back to client
    res.setHeader('X-Request-Id', requestId);

    const contextData: RequestContextData = {
      requestId,
      traceId,
      tenantId: null, // Tenant ID is only populated after application validation
      startTime: Date.now(),
      metadata: {},
    };

    this.requestContextService.run(contextData, () => {
      next();
    });
  }
}
