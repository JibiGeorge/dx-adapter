import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import {
  SKIP_THROTTLE_KEY,
  THROTTLE_LIMIT_KEY,
  THROTTLE_TTL_KEY,
} from '../decorators/throttle.decorator';

interface ClientRecord {
  timestamps: number[];
}

@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly logger = new Logger(RateLimiterGuard.name);
  private readonly hits = new Map<string, ClientRecord>();
  private readonly defaultLimit: number;
  private readonly defaultTtl: number; // in seconds

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.defaultLimit = Number(this.configService.get('RATE_LIMIT_MAX')) || 60;
    this.defaultTtl = Number(this.configService.get('RATE_LIMIT_TTL')) || 60;

    // Periodic cleanup every 5 minutes to prevent memory leak
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (timer.unref) {
      timer.unref();
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isSkipped = this.reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Skip rate limiting if explicitly marked or on health check
    if (isSkipped || this.isHealthCheck(request)) {
      return true;
    }

    const limit =
      this.reflector.getAllAndOverride<number>(THROTTLE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.defaultLimit;

    const ttl =
      this.reflector.getAllAndOverride<number>(THROTTLE_TTL_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? this.defaultTtl;

    const clientId = this.getClientIdentifier(request);
    const now = Date.now();
    const windowStart = now - ttl * 1000;

    let record = this.hits.get(clientId);
    if (!record) {
      record = { timestamps: [] };
      this.hits.set(clientId, record);
    }

    // Filter out timestamps outside the sliding window
    record.timestamps = record.timestamps.filter((t) => t > windowStart);

    const remaining = Math.max(0, limit - record.timestamps.length);
    const oldestTimestamp = record.timestamps[0] ?? now;
    const resetTime = Math.ceil((oldestTimestamp + ttl * 1000) / 1000);
    const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + ttl * 1000 - now) / 1000));

    // Set standard rate limit headers
    response.setHeader('X-RateLimit-Limit', limit.toString());
    response.setHeader('X-RateLimit-Remaining', Math.max(0, remaining - 1).toString());
    response.setHeader('X-RateLimit-Reset', resetTime.toString());

    if (record.timestamps.length >= limit) {
      response.setHeader('Retry-After', retryAfter.toString());
      this.logger.warn(`Rate limit exceeded for client [${clientId}]: ${record.timestamps.length}/${limit} reqs`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TOO_MANY_REQUESTS',
          message: `Too many requests. Limit is ${limit} requests per ${ttl} seconds. Retry after ${retryAfter} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Record the current request timestamp
    record.timestamps.push(now);
    return true;
  }

  private getClientIdentifier(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : (forwardedFor?.split(',')[0]?.trim() || request.ip || request.socket.remoteAddress || 'unknown-ip');

    const apiKey =
      request.headers['x-api-key'] ?? request.headers['api-key'];
    const keyString = Array.isArray(apiKey) ? apiKey[0] : apiKey;

    return keyString ? `key:${keyString}:${ip}` : `ip:${ip}`;
  }

  private isHealthCheck(request: Request): boolean {
    const path = (request.path || request.url || '').toLowerCase();
    return path.includes('healthcheck') || path.includes('/health');
  }

  private cleanup(): void {
    const now = Date.now();
    const maxTtl = this.defaultTtl * 1000;
    for (const [key, record] of this.hits.entries()) {
      record.timestamps = record.timestamps.filter((t) => now - t < maxTtl);
      if (record.timestamps.length === 0) {
        this.hits.delete(key);
      }
    }
  }
}
