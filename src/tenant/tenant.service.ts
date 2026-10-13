
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { LoggingService } from '../../common/logging/logging.service.js';
import { RequestContextService } from '../../common/logging/request-context.service.js';
import { AppCacheService } from '../cache/app-cache.service.js';
import {
  TenantConfigTypes,
  TenantPublicResponse,
} from './tenant.types.js';

// Re-export for backwards compatibility with other modules importing TenantConfig
export type { TenantConfigTypes };

@Injectable()
export class TenantService {
  constructor(
    private readonly logger: LoggingService,
    private readonly requestContext: RequestContextService,
    private readonly cache: AppCacheService,
  ) { }

  private getConfigFilePath(): string {
    const cwdPath = path.resolve(
      process.cwd(),
      'utils',
      'config.json',
    );

    if (existsSync(cwdPath)) {
      return cwdPath;
    }

    const relPath = path.resolve(
      __dirname,
      '../../../utils/config.json',
    );

    if (existsSync(relPath)) {
      return relPath;
    }

    return cwdPath;
  }

  private async loadConfig(): Promise<TenantConfigTypes[]> {
    const filePath = this.getConfigFilePath();

    try {
      const fileData = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(fileData) as TenantConfigTypes[];
    } catch (error) {
      this.logger.error(
        `Failed to read tenant config file from ${filePath}`,
        error instanceof Error ? error.stack : undefined,
        'TenantService',
        { filePath },
      );
      throw error;
    }
  }

  // Return only the public-safe fields in API responses.
  private toPublicResponse(tenant: TenantConfigTypes): TenantPublicResponse {
    return {
      id: tenant.id,
      tentantId: tenant.tentantId,
      name: tenant.name,
      status: tenant.status,
      config: {
        name: tenant.config.name,
        domain: tenant.config.domain,
        port: tenant.config.port,
      },
      branding: {
        logoUrl: tenant.branding.logoUrl,
        primaryColor: tenant.branding.primaryColor,
        secondaryColor: tenant.branding.secondaryColor,
      },
    };
  }

  /**
   * Returns the COMPLETE cached tenant object (including internal fields like apis, db).
   * Intended for internal service-to-service use only — never expose this directly in API responses.
   * Throws NotFoundException if the tenant has not been resolved yet (cache miss).
   */
  async getFullTenantById(tenantId: string): Promise<TenantConfigTypes> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('Tenant ID is required');
    }

    const cacheKey = `tenant:${tenantId}:config`;
    const cached = await this.cache.get<TenantConfigTypes>(cacheKey);

    if (cached) {
      return cached;
    }

    // Cache miss: load from file and populate cache
    const startTime = Date.now();
    const tenants = await this.loadConfig();
    const tenant = tenants.find(
      (t) => t.tentantId === tenantId || t.tentantId === tenantId,
    );

    if (!tenant) {
      this.logger.warn(
        `Tenant not found for internal lookup: ${tenantId}`,
        'TenantService',
        { tenantId, durationMs: Date.now() - startTime },
      );
      throw new NotFoundException(`Tenant with ID '${tenantId}' not found`);
    }

    await this.cache.set(cacheKey, tenant, 300_000);
    return tenant;
  }

  async getTenantconfigById(
    id: string,
  ): Promise<TenantPublicResponse> {

    if (!id?.trim()) {
      throw new BadRequestException('Tenant ID is required in x-tenant-id header');
    }

    const startTime = Date.now();
    const cacheKey = `tenant:${id}:config`;

    this.logger.debug(
      `Starting tenant configuration lookup for ID: ${id}`,
      'TenantService',
      { requestedId: id },
    );

    // 1. Check the cache, which stores the complete tenant object.
    const cached = await this.cache.get<TenantConfigTypes>(cacheKey);

    if (cached !== undefined && cached !== null) {
      this.requestContext.setTenantId(cached.tentantId);

      this.logger.log(
        `Tenant configuration retrieved from cache for '${cached.name}'`,
        'TenantService',
        {
          tenantId: cached.tentantId,
          tenantName: cached.name,
          status: cached.status,
          cached: true,
          durationMs: Date.now() - startTime,
        },
      );

      // Return only the approved fields.
      return this.toPublicResponse(cached);
    }

    // 2. Cache miss: load the full tenant data.
    const tenants = await this.loadConfig();

    const tenant = tenants.find(
      (t) => t.tentantId === id || t.tentantId === id,
    );

    if (!tenant) {
      const durationMs = Date.now() - startTime;

      this.logger.warn(
        `Tenant configuration lookup failed for ID: ${id}`,
        'TenantService',
        { requestedId: id, durationMs },
      );

      throw new NotFoundException(
        `Tenant with ID '${id}' not found`,
      );
    }

    // 3. Set the validated tenant ID in request context.
    this.requestContext.setTenantId(tenant.tentantId);

    // 4. Cache the COMPLETE tenant object, including extra fields.
    await this.cache.set(cacheKey, tenant, 300_000);

    const durationMs = Date.now() - startTime;

    this.logger.log(
      `Tenant configuration retrieved successfully for '${tenant.name}'`,
      'TenantService',
      {
        tenantId: tenant.tentantId,
        tenantName: tenant.name,
        status: tenant.status,
        cached: false,
        durationMs,
      },
    );

    // 5. Return ONLY the approved fields.
    return this.toPublicResponse(tenant);
  }
}
