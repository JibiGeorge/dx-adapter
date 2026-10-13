import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from './tenant/tenant.module';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RateLimiterGuard } from '../common/guards/rate-limiter.guard';
import { SecurityHeadersMiddleware } from '../common/middleware/security-headers.middleware';
import { LoggingModule } from '../common/logging/logging.module.js';
import { RequestContextMiddleware } from '../common/logging/request-context.middleware.js';
import { HttpLoggingInterceptor } from '../common/logging/http-logging.interceptor.js';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { CacheModule } from '@nestjs/cache-manager';
import { AppCacheModule } from './cache/cache.module';
import { AuthModule } from './auth/auth.module';
import { TenantIdGuard } from '../common/guards/tenant-id.guard';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 300_000, // 5 minutes, in milliseconds
      max: 1000, // maximum number of cached entries
    }),
    LoggingModule,
    TenantModule,
    AppCacheModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimiterGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantIdGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware, SecurityHeadersMiddleware)
      .forRoutes('*');
  }
}



