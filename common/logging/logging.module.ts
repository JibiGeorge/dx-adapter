import { Global, Module } from '@nestjs/common';
import { LoggingService } from './logging.service.js';
import { RequestContextService } from './request-context.service.js';
import { HttpLoggingInterceptor } from './http-logging.interceptor.js';
import { RequestContextMiddleware } from './request-context.middleware.js';

@Global()
@Module({
  providers: [
    LoggingService,
    RequestContextService,
    HttpLoggingInterceptor,
    RequestContextMiddleware,
  ],
  exports: [
    LoggingService,
    RequestContextService,
    HttpLoggingInterceptor,
    RequestContextMiddleware,
  ],
})
export class LoggingModule {}
