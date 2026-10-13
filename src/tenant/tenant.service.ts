import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface TenantConfig {
  id: string;
  tentantId: string;
  name: string;
  status: string;
  config: {
    name: string;
    domain: string;
    port: number;
    env: string;
    db: {
      host: string;
      port: number;
      dbName: string;
    };
  };
  branding: {
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
  };
  apis: {
    authApi: {
      url: string;
      timeoutMs: number;
    };
  };
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

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
      this.logger.error(`Failed to read tenant config file from ${filePath}`, error);
      throw error;
    }
  }

  async getTenantconfigById(id: string): Promise<TenantConfig> {
    this.logger.log(`Fetching tenant config for ID: ${id}`);
    const tenants = await this.loadConfig();
    const tenant = tenants.find(
      (t) => t.tentantId === id || (t as any).tenantId === id,
    );

    if (!tenant) {
      this.logger.warn(`Tenant with ID '${id}' not found`);
      throw new NotFoundException(`Tenant with ID '${id}' not found`);
    }

    return tenant;
  }
}