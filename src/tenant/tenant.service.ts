import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { LoggingService } from '../../common/logging/logging.service.js';
import { RequestContextService } from '../../common/logging/request-context.service.js';
import { AppCacheService } from '../cache/app-cache.service.js';
import { TenantRepository } from '../database/repositories/tenant.repository.js';
import {
  TenantConfigTypes,
  TenantPublicResponse,
} from './tenant.types.js';

// Re-export for backwards compatibility with other modules importing TenantConfigTypes
export type { TenantConfigTypes };

@Injectable()
export class TenantService {
  constructor(
    private readonly logger: LoggingService,
    private readonly requestContext: RequestContextService,
    private readonly cache: AppCacheService,
    private readonly tenantRepository: TenantRepository,
  ) { }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /** Return only public-safe fields — never exposes DB credentials or API secrets */
  private toPublicResponse(
    tenant: TenantConfigTypes,
  ): TenantPublicResponse {
    return {
      status: tenant.status,
      tenantId: tenant.tenantId,
      domains: tenant.domains,
      version: tenant.version,
      config: {
        app: {
          name: tenant.config.app.name,
          url: tenant.config.app.url,
          serviceUrl: tenant.config.app.serviceUrl,
        },
      },
    };
  }

  /** Shared lookup: cache → MongoDB. Populates cache on miss. */
  private async resolveTenant(tenantId: string): Promise<TenantConfigTypes> {
    const cacheKey = `tenant:${tenantId}:config`;

    // 1. Cache hit
    const cached = await this.cache.get<TenantConfigTypes>(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Cache miss — query MongoDB
    const startTime = Date.now();
    const tenant = await this.tenantRepository.findByTenantId(tenantId);
    console.log("tenant", tenant)
    if (!tenant) {
      this.logger.warn(
        `Tenant not found: ${tenantId}`,
        'TenantService',
        { tenantId, durationMs: Date.now() - startTime },
      );
      throw new NotFoundException(`Tenant with ID '${tenantId}' not found`);
    }

    // 3. Populate cache with full object (TTL: 5 minutes)
    await this.cache.set(cacheKey, tenant, 300_000);
    return tenant;
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  /**
   * Returns the COMPLETE tenant object including internal fields (APIs, DB creds).
   * For internal service-to-service use only — never expose directly in API responses.
   */
  async getFullTenantById(tenantId: string): Promise<TenantConfigTypes> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.resolveTenant(tenantId.trim());
  }

  /**
   * Returns only the public-safe tenant config fields.
   * Used by the /tenant/config endpoint.
   */
  async getTenantconfigById(id: string): Promise<TenantPublicResponse> {
    if (!id?.trim()) {
      throw new BadRequestException('Tenant ID is required in x-tenant-id header');
    }

    const startTime = Date.now();
    const tenantId = id.trim();

    this.logger.debug(
      `Tenant configuration lookup for ID: ${tenantId}`,
      'TenantService',
      { requestedId: tenantId },
    );

    const tenant = await this.resolveTenant(tenantId);

    // Set validated tenant ID in request correlation context
    this.requestContext.setTenantId(tenant.tenantId);

    const durationMs = Date.now() - startTime;
    const fromCache = (await this.cache.get(`tenant:${tenantId}:config`)) !== undefined;

    this.logger.log(
      `Tenant configuration resolved for '${tenant.config.app.name}'`,
      'TenantService',
      {
        tenantId: tenant.tenantId,
        tenantName: tenant.config.app.name,
        status: tenant.status,
        cached: fromCache,
        durationMs,
      },
    );

    return this.toPublicResponse(tenant);
  }
}
