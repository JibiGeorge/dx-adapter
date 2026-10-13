// ─── Internal (full) types — used server-side only, never returned to clients ──

export interface TenantDbConfig {
  host: string;
  port: number;
  dbName: string;
}

export interface TenantAuthApiConfig {
  url: string;
  timeoutMs: number;
}

export interface TenantApisConfig {
  authApi: TenantAuthApiConfig;
}

/** Full server-side config — includes DB credentials and internal API config */
export interface TenantInternalConfig {
  name: string;
  domain: string;
  port: number;
  env: string;
  db: TenantDbConfig;
}

export interface TenantBranding {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
}

/** Full tenant record stored in config.json and cached internally */
export interface TenantConfigTypes {
  id: string;
  tentantId: string;
  name: string;
  status: TenantStatus;
  config: TenantInternalConfig;
  branding: TenantBranding;
  apis: TenantApisConfig;
}

// ─── Public (safe) types — returned from API responses ────────────────────────

/** Subset of config safe to return to clients — no DB, no internal env, no API secrets */
export interface TenantPublicConfig {
  name: string;
  domain: string;
  port: number;
}

/** Tenant data shape returned in API responses */
export interface TenantPublicResponse {
  id: string;
  tentantId: string;
  name: string;
  status: TenantStatus;
  config: TenantPublicConfig;
  branding: TenantBranding;
}

// ─── Enums / Literals ─────────────────────────────────────────────────────────

export type TenantStatus = 'Active' | 'Inactive' | 'Suspended';
