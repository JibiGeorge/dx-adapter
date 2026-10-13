import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { LoggingService } from '../../common/logging/logging.service.js';
import { RequestContextService } from '../../common/logging/request-context.service.js';
import { AppCacheService } from '../cache/app-cache.service.js';

export interface TenantConfig {
  id: string;
  tentantId: string;
  name: string;
  status: string;
  config: {
    name: string;
    domain: string;
    port: number;
  };
  branding: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
  };
}

@Injectable()
export class TenantService {
  constructor(
    private readonly logger: LoggingService,
    private readonly requestContext: RequestContextService,
    private readonly cache: AppCacheService,
  ) {}

  private getConfigFilePath(): string {
    const cwdPath = path.resolve(process.cwd(), 'utils', 'config.json');
    if (existsSync(cwdPath)) {
      return cwdPath;
    }
    const relPath = path.resolve(__dirname, '../../../utils/config.json');
    if (existsSync(relPath)) {
      return relPath;
    }
    return cwdPath;
  }

  private async loadConfig(): Promise<TenantConfig[]> {
    const filePath = this.getConfigFilePath();
    try {
      const fileData = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(fileData) as TenantConfig[];
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

  
private selectTenantConfig(tenant: TenantConfig): TenantConfig {
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


  async getTenantconfigById(id: string): Promise<TenantConfig> {
    const startTime = Date.now();
    this.logger.debug(
      `Starting tenant configuration lookup for ID: ${id}`,
      'TenantService',
      { requestedId: id },
    );

    const cacheKey = `tenant:${id}:config`;
    
    // 1. Check the in-memory cache.
    const cached = await this.cache.get<TenantConfig>(cacheKey);

    if (cached !== undefined) {
      this.logger.log(
        `Tenant configuration retrieved from cache for '${cached.name}'`,
        'TenantService',
        {
          tenantId: cached.tentantId,
          tenantName: cached.name,
          status: cached.status,
          cached: true,
        },
      );
      return cached;
    }

    const tenants = await this.loadConfig();
    const tenant = tenants.find(
      (t) => t.tentantId === id || (t as any).tenantId === id,
    );

    const durationMs = Date.now() - startTime;

    if (!tenant) {
      this.logger.warn(
        `Tenant configuration lookup failed: tenant with ID '${id}' not found`,
        'TenantService',
        { requestedId: id, durationMs },
      );
      throw new NotFoundException(`Tenant with ID '${id}' not found`);
    }

    // Set validated tenant ID in request correlation context
    this.requestContext.setTenantId(tenant.tentantId);

    await this.cache.set(cacheKey, tenant, 300_000);

    // Securely log non-sensitive operational metadata (never credentials, DB info, or full config)
    this.logger.log(
      `Tenant configuration retrieved successfully for '${tenant.name}' [${durationMs}ms]`,
      'TenantService',
      {
        tenantId: tenant.tentantId,
        tenantName: tenant.name,
        status: tenant.status,
        durationMs,
      },
    );

    return this.selectTenantConfig(tenant);
  }
}
