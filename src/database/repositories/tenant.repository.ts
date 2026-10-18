import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Collection } from 'mongoose';
import { TenantConfigTypes } from '../../tenant/tenant.types.js';

@Injectable()
export class TenantRepository {
  private readonly collection: Collection;

  constructor(
    @InjectConnection()
    connection: Connection,
    configService: ConfigService,
  ) {
    const dbName = configService.getOrThrow<string>('CONFIG_MONGO_DB') || "IPMI_Tenant_STG";
    const collectionName = configService.getOrThrow<string>('CONFIG_MONGO_COLLECTION') || "TenantConfiguration";

    // Switch to the specified database and bind to the named collection
    this.collection = connection.useDb(dbName).collection(collectionName);
  }

  /**
   * Find a tenant by its tentantId.
   * Returns null when no matching document exists.
   */
  async findByTenantId(tenantId: string): Promise<TenantConfigTypes | null> {
    const doc = await this.collection.findOne<Record<string, any>>(
      { tenantId },
      { projection: { _id: 0 } },
    );

    if (!doc) return null;

    return this.toConfigTypes(doc);
  }

  /**
   * Map a raw MongoDB document to the canonical TenantConfigTypes shape.
   */
  private toConfigTypes(
    doc: Record<string, any>,
  ): TenantConfigTypes {
    return {
      status: doc.status,
      tenantId: doc.tenantId,
      domains: Array.isArray(doc.domains) ? doc.domains : [],
      version: doc.version ?? 1,

      config: {
        corpId: doc.config?.corpId ?? 0,
        macpDb: doc.config.macpDb ?? '',
        app: {
          name: doc.config?.app?.name ?? '',
          url: doc.config?.app?.url ?? '',
          serviceUrl: doc.config?.app?.serviceUrl ?? '',
        },

        auth: {
          api: doc.config?.auth?.api ?? '',
          appId: doc.config?.auth?.appId ?? 0,
        },

        services: {
          memberConfig: doc.config?.services?.memberConfig ?? '',
          ecard: doc.config?.services?.ecard ?? '',
          memberPolicy: doc.config?.services?.memberPolicy ?? '',
        },

        claimApis: {
          v1: doc.config?.claimApis?.v1 ?? '',
          v1Lawton: doc.config?.claimApis?.v1Lawton ?? '',
          v2: doc.config?.claimApis?.v2 ?? '',
          v2Key: doc.config?.claimApis?.v2Key ?? '',
          v3: doc.config?.claimApis?.v3 ?? '',
          pairKey: doc.config?.claimApis?.pairKey ?? '',
        },

        database: {
          type: doc.config?.database?.type ?? 'mssql',
          host: doc.config?.database?.host ?? '',
          port: doc.config?.database?.port ?? 0,
          user: doc.config?.database?.user ?? '',
          password: doc.config?.database?.password ?? '',
          name: doc.config?.database?.name ?? '',
        },

        memberConfigDb: {
          uri: doc.config?.memberConfigDb?.uri ?? '',
          dbName: doc.config?.memberConfigDb?.dbName ?? '',
        },

        email: {
          fromEmailId: doc.config?.email?.fromEmailId ?? '',
          smtp: doc.config?.email?.smtp ?? {},
          passwordReset: doc.config?.email?.passwordReset ?? {},
        },

        sms: {
          templates: doc.config?.sms?.templates ?? {},
        },

        auraHealth: {
          orgCode: doc.config?.auraHealth?.orgCode ?? '',
          webhookLink: doc.config?.auraHealth?.webhookLink ?? '',
        },

        additionalConfigs: {
          allowedTPAIds: doc.config?.additionalConfigs?.allowedTPAIds ?? '',
          brokerDashboards: Array.isArray(doc.config?.additionalConfigs?.brokerDashboards)
            ? doc.config.additionalConfigs.brokerDashboards
            : [],
          hrDashboards: Array.isArray(doc.config?.additionalConfigs?.hrDashboards)
            ? doc.config.additionalConfigs.hrDashboards
            : [],
        },
        dataexchange: {
          api: doc.config?.dataexchange?.api ?? '',
          key: doc.config?.dataexchange?.key ?? '',
        },
      },
    };
  }
}