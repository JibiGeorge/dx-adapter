import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter.js';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { LoggingService } from '../common/logging/logging.service.js';
import { RequestContextService } from '../common/logging/request-context.service.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(LoggingService);
  const requestContext = app.get(RequestContextService);

  // Set centralized production-ready logger for NestJS runtime
  app.useLogger(logger);

  // Disable technology fingerprinting
  app.disable('x-powered-by');

  // Hardened CORS configuration
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-api-key',
      'api-key',
      'x-request-id',
      'x-correlation-id',
      'traceparent',
    ],
    credentials: true,
    maxAge: 3600,
  });

  // Protect against large payload DoS attacks
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  // Strict input validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter(logger, requestContext));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  logger.log(`Backend API (BFF) running on port ${port}`, 'Bootstrap');
}

bootstrap();