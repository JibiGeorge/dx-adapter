import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Collection } from 'mongoose';
import { LoggingService } from '../../common/logging/logging.service.js';
import { TenantService } from '../tenant/tenant.service.js';

@Injectable()
export class ThemeService {
  private readonly collection: Collection;

  constructor(
    @InjectConnection()
    connection: Connection,
    configService: ConfigService,
    private readonly tenantService: TenantService,
    private readonly logger: LoggingService,
  ) {
    // Use the same profile MongoDB configuration
    const dbName =
      configService.get<string>('USER_PROFILE_MONGO_DB') ||
      configService.get<string>('CONFIG_MONGO_DB') ||
      'IPMI_Tenant_STG';

    const collectionName =
      configService.get<string>('THEME_STORE_MONGO_COLLECTION') || 'theme-store';

    this.collection = connection.useDb(dbName).collection(collectionName);
  }

  async getTheme(
    tenantIdParam?: string,
    corpIdParam?: string | number,
    hostParam?: string,
  ): Promise<{ ok: boolean; theme: any }> {
    const startedAt = Date.now();
    try {
      const effectiveTenantId = (tenantIdParam || '').trim();
      const corpId =
        corpIdParam !== undefined && corpIdParam !== null && corpIdParam !== ''
          ? Number(corpIdParam)
          : null;

      // Resolve tenant configuration using tenantId first
      let tenantConfig = null;
      if (effectiveTenantId) {
        tenantConfig = await this.tenantService
          .getFullTenantById(effectiveTenantId)
          .catch(() => null);
      }

      // Fallback: resolve by host if tenantId did not find a match
      if (!tenantConfig && hostParam?.trim()) {
        tenantConfig = await this.tenantService
          .getTenantByHost(hostParam.trim())
          .catch(() => null);
      }

      // Determine tpaIdentifier (fallback to tenantId or config app name or normalized host)
      const tpaIdentifier =
        (tenantConfig as any)?.tpaIdentifier ||
        tenantConfig?.tenantId ||
        effectiveTenantId ||
        (tenantConfig as any)?.config?.app?.name ||
        '';

      const proj = { projection: { _id: 0 } };
      const notDisabled = { isDisabled: { $ne: true } };
      let theme = null;

      // Build candidate identifiers to match against theme-store
      const identifiers = Array.from(
        new Set([tpaIdentifier, tenantConfig?.tenantId, effectiveTenantId, 'default'].filter(Boolean)),
      );

      // Priority 1: corp-specific active theme
      if (corpId && corpId > 0) {
        for (const id of identifiers) {
          theme = await this.collection.findOne(
            { tpaIdentifier: id, corpId, isActive: true, ...notDisabled },
            proj,
          );
          if (theme) break;
        }
      }

      // Priority 2: tenant-level active theme (documents without a corpId field or corpId null)
      if (!theme) {
        for (const id of identifiers) {
          theme = await this.collection.findOne(
            {
              tpaIdentifier: id,
              $or: [{ corpId: { $exists: false } }, { corpId: null }],
              isActive: true,
              ...notDisabled,
            },
            proj,
          );
          if (theme) break;
        }
      }

      // Priority 3: any active theme for this tenant (final fallback)
      if (!theme) {
        for (const id of identifiers) {
          theme = await this.collection.findOne(
            { tpaIdentifier: id, isActive: true, ...notDisabled },
            proj,
          );
          if (theme) break;
        }
      }

      const durationMs = Date.now() - startedAt;
      this.logger.debug(
        `Theme resolved in ${durationMs}ms (found=${Boolean(theme)}) for tenantId=${effectiveTenantId || tpaIdentifier}, corpId=${corpId}`,
        ThemeService.name,
        { tenantId: effectiveTenantId || tpaIdentifier, corpId, tpaIdentifier, hasTheme: Boolean(theme) },
      );

      return { ok: true, theme: theme || null };
    } catch (err: any) {
      // MongoDB unavailable or error — return null so the frontend keeps its default styles
      this.logger.warn(`Error resolving theme: ${err?.message}`, ThemeService.name);
      return { ok: true, theme: null };
    }
  }
}
