// ─── Shared types ────────────────────────────────────────────────────────────

export type TenantStatus = 'active' | 'inactive' | 'suspended';

export interface TenantSmtpConfig {
  [key: string]: unknown;
}

export interface TenantPasswordResetConfig {
  [key: string]: unknown;
}

export interface TenantEmailConfig {
  fromEmailId: string;
  smtp: TenantSmtpConfig;
  passwordReset: TenantPasswordResetConfig;
}

export interface TenantSmsConfig {
  templates: Record<string, unknown>;
}

// ─── Application configuration ──────────────────────────────────────────────

export interface TenantAppConfig {
  name: string;
  url: string;
  serviceUrl: string;
}

export interface TenantAuthConfig {
  api: string;
  appId: number;
}

export interface TenantServicesConfig {
  memberConfig: string;
  ecard: string;
  memberPolicy: string;
}

export interface TenantClaimApisConfig {
  v1: string;
  v1Lawton: string;
  v2: string;
  v2Key: string;
  v3: string;
  pairKey: string;
}

export interface TenantDatabaseConfig {
  type: 'mssql' | 'mongodb' | string;
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
}

export interface TenantMemberConfigDb {
  uri: string;
  dbName: string;
}

export interface TenantAuraHealthConfig {
  orgCode: string;
  webhookLink: string;
}

// ─── Full internal configuration ────────────────────────────────────────────

/**
 * Complete tenant configuration.
 * Internal server-side only.
 *
 * Contains credentials, API keys, connection strings and internal URLs.
 * Never return this object directly from a public controller.
 */
export interface TenantInternalConfig {
  corpId: string | number;
  app: TenantAppConfig;
  auth: TenantAuthConfig;
  services: TenantServicesConfig;
  claimApis: TenantClaimApisConfig;
  database: TenantDatabaseConfig;
  memberConfigDb: TenantMemberConfigDb;
  email: TenantEmailConfig;
  sms: TenantSmsConfig;
  auraHealth: TenantAuraHealthConfig;
  additionalConfigs: TenantAdditionalConfigs;
  dataexchange: {
    api: string;
  }
}

/**
 * Full tenant record returned by the configuration provider
 * and stored in the internal cache.
 */
export interface TenantConfigTypes {
  status: TenantStatus;
  tenantId: string;
  domains: string[];
  version: number;
  config: TenantInternalConfig;
}

// ─── Public configuration ───────────────────────────────────────────────────

/**
 * Safe application configuration exposed to clients.
 * Add only fields that are intended to be public.
 */
export interface TenantPublicConfig {
  app: {
    name: string;
    url: string;
    serviceUrl: string;
  };
}

/**
 * Tenant data returned by the public tenant-config endpoint.
 */
export interface TenantPublicResponse {
  status: TenantStatus;
  tenantId: string;
  domains: string[];
  version: number;
  config: TenantPublicConfig;
}

export interface TenantAdditionalConfigs {
  allowedTPAIds: string;
  brokerDashboards: TenantDashboardOption[];
  hrDashboards: TenantDashboardOption[];
}

export interface TenantDashboardOption {
  key: string;
  label: string;
  includeDepartmentFilter: boolean;
  filterTable: string;
  filterColumn: string;
  filterOn: string;
}