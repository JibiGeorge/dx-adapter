import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_TENANT_CHECK_KEY } from '../decorators/skip-tenant-check.decorator';

@Injectable()
export class TenantIdGuard implements CanActivate {
  private readonly logger = new Logger(TenantIdGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Skip for @Public() routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Skip for routes decorated with @SkipTenantCheck()
    const skipTenantCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenantCheck) return true;

    const request = context.switchToHttp().getRequest<Request>();

    // Skip health check and config endpoints automatically
    if (this.isExemptRoute(request)) return true;

    const tenantId = request.headers['x-tenant-id'];
    const resolvedId = Array.isArray(tenantId) ? tenantId[0] : tenantId;

    if (!resolvedId || typeof resolvedId !== 'string' || !resolvedId.trim()) {
      this.logger.warn(
        `Missing x-tenant-id header: ${request.method} ${request.path}`,
      );
      throw new BadRequestException(
        'Missing required header: x-tenant-id',
      );
    }

    return true;
  }

  private isExemptRoute(request: Request): boolean {
    const path = (request.path || request.url || '').toLowerCase();
    return (
      path.includes('healthcheck') ||
      path.includes('/health') ||
      // /tenant/config is the config lookup route — tenant ID comes from its own header handling
      path.endsWith('/tenant/config')
    );
  }
}
