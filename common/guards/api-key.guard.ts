import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) { }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();

    // Allow public routes and health check endpoints
    if (isPublic || this.isHealthCheck(request)) {
      return true;
    }

    const rawKey =
      request.headers['x-api-key'] ?? request.headers['api-key'];
    const clientKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!clientKey) {
      this.logger.warn(`API key missing from request: ${request.method} ${request.url}`);
      throw new UnauthorizedException('Missing API key in header (x-api-key or api-key)');
    }

    const validApiKey = this.configService.get<string>('API_KEY');

    if (!validApiKey) {
      this.logger.error('API_KEY is not defined in the environment configuration');
      throw new UnauthorizedException('API key is not configured on the server');
    }

    if (clientKey !== validApiKey) {
      this.logger.warn(`Invalid API key provided for request: ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }

  private isHealthCheck(request: Request): boolean {
    const path = (request.path || request.url || '').toLowerCase();
    return path.includes('healthcheck') || path.includes('/health');
  }
}
