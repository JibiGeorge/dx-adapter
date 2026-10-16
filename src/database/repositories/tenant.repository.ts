import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Collection } from 'mongoose';
import { TenantConfigTypes } from '../../tenant/tenant.types.js';

@Injectable()
export class TenantRepository {
  private readonly logger = new Logger(TenantRepository.name);
  private readonly collection: Collection | null = null;
  private readonly componentCollection: Collection | null = null;

  constructor(
    @InjectConnection()
    connection: Connection,
    configService: ConfigService,
  ) {
    const dbName = configService.get<string>('CONFIG_MONGO_DB');
    const collectionName = configService.get<string>('CONFIG_MONGO_COLLECTION');
    const componentCollectionName = configService.get<string>('CONFIG_MONGO_COMPONENT_COLLECTION');

    if (!dbName) {
      this.logger.warn('CONFIG_MONGO_DB is not defined in environment. Database connection will be uninitialized.');
    }

    if (dbName && collectionName) {
      this.collection = connection.useDb(dbName).collection(collectionName);
    } else {
      this.logger.warn('CONFIG_MONGO_COLLECTION or CONFIG_MONGO_DB is not defined in environment. Tenant queries will fail gracefully.');
    }

    if (dbName && componentCollectionName) {
      this.componentCollection = connection.useDb(dbName).collection(componentCollectionName);
    } else {
      this.logger.warn('CONFIG_MONGO_COMPONENT_COLLECTION or CONFIG_MONGO_DB is not defined in environment. Component queries will fail gracefully.');
    }
  }

  /**
   * Find a tenant by its tentantId.
   * Returns null when no matching document exists or when configuration is missing.
   */
  async findByTenantId(tenantId: string): Promise<TenantConfigTypes | null> {
    if (!this.collection) {
      this.logger.warn(`Tenant query for '${tenantId}' skipped: TenantConfiguration collection not configured.`);
      return null;
    }

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
      },
    };
  }

  /**
   * Find component configuration by tenantId, portalKey, or role from ComponentConfiguration collection.
   */
  async findComponents(filter: { tenantId?: string; portalKey?: string; role?: string }): Promise<any | null> {
    if (!this.componentCollection) {
      this.logger.warn('Component configuration query skipped: ComponentConfiguration collection not configured.');
      return null;
    }

    const query: Record<string, any> = {};
    if (filter.portalKey) {
      query.portalKey = filter.portalKey;
    }
    if (filter.tenantId) {
      query.tenantId = filter.tenantId;
    }
    if (filter.role) {
      query.role = filter.role;
    }

    const doc = await this.componentCollection.findOne<Record<string, any>>(
      query,
      { projection: { _id: 0 } },
    );

    return doc;
  }
}