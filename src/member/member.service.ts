import { Injectable, InternalServerErrorException } from '@nestjs/common';
import sql from 'mssql';
import { LoggingService } from '../../common/logging/logging.service.js';
import { ClaimApiService } from '../integrations/claim-api/claim-api.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { SqlServerService } from '../database/sql-server.service.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { TenantConfigTypes } from '../tenant/tenant.types.js';

@Injectable()
export class MemberService {
  constructor(
    private readonly logger: LoggingService,
    private readonly claimService: ClaimApiService,
    private readonly tenantService: TenantService,
    private readonly sqlServerService: SqlServerService,
  ) {}

  async getPolicies(
    tenantId: string,
    user: UserSessionPayload,
  ): Promise<{
    success: boolean;
    policies: any[];
    error?: string;
  }> {
    const startedAt = Date.now();
    const normalizedTenantId = tenantId.trim();
    const maid = Number(user?.maid) || 0;

    try {
      let policies: any[] = [];

      if (maid > 0) {
        try {
          const tenantConfig: TenantConfigTypes =
            await this.tenantService.getFullTenantById(normalizedTenantId);
          const dbConfig = tenantConfig?.config?.database;

          if (dbConfig) {
            const pool = await this.sqlServerService.getPool(dbConfig);
            const result = await pool
              .request()
              .input('maid', sql.BigInt, maid)
              .query(`
                SELECT TOP 10 * FROM Lawton.dbo.tblmaPriBeneficiary WITH(NOLOCK)
                WHERE PriBenefRefNo = @maid OR PriBenefEmpCode = (
                  SELECT TOP 1 value FROM tblSendOTP WITH(NOLOCK) WHERE UserId = @maid
                )
              `);

            if (result.recordset && result.recordset.length > 0) {
              policies = result.recordset;
            }
          }
        } catch (dbErr: any) {
          this.logger.warn(
            `Database query for member policies failed: ${dbErr?.message}`,
            MemberService.name,
            { tenantId: normalizedTenantId, maid },
          );
        }
      }

      const durationMs = Date.now() - startedAt;
      this.logger.debug(
        `Member policies fetched in ${durationMs}ms (count=${policies.length}) for maid=${maid}`,
        MemberService.name,
        { tenantId: normalizedTenantId, maid, count: policies.length },
      );

      return {
        success: true,
        policies,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `Error fetching member policies after ${durationMs}ms: ${err.message}`,
        err.stack,
        MemberService.name,
        { tenantId: normalizedTenantId, maid },
      );
      return {
        success: false,
        error: 'Internal server error fetching policies',
        policies: [],
      };
    }
  }

  async getClaims(
    tenantId: string,
    user: UserSessionPayload,
    hostHeader?: string,
  ): Promise<{
    success: boolean;
    claims: any[];
    error?: string;
  }> {
    const startedAt = Date.now();
    const normalizedTenantId = tenantId.trim();
    const maid = Number(user?.maid) || 0;

    try {
      let claims: any[] = [];

      if (maid > 0) {
        const tenantConfig: TenantConfigTypes =
          await this.tenantService.getFullTenantById(normalizedTenantId);

        // 1. Try fetching live claims via Claim API
        const claimApiBaseUrl =
          tenantConfig?.config?.claimApis?.v2 ||
          tenantConfig?.config?.claimApis?.v3 ||
          '';

        if (claimApiBaseUrl) {
          try {
            const claimsRes = await this.claimService.searchClaims(
              claimApiBaseUrl,
              tenantConfig,
              {
                BeneficiaryMediAssistID: maid,
                NONCMSClaimRequired: false,
                ShowallClaims: true,
              },
              'member',
            );

            claims =
              claimsRes?.claimDetails ||
              claimsRes?.ClaimDetails ||
              claimsRes?.claimSearchResults ||
              [];
          } catch (apiErr: any) {
            this.logger.warn(
              `Claim API search failed for member, trying DB: ${apiErr?.message}`,
              MemberService.name,
              { tenantId: normalizedTenantId, maid },
            );
          }
        }

        // 2. If Claim API returned nothing, check MSSQL database
        if (claims.length === 0) {
          const dbConfig = tenantConfig?.config?.database;
          if (dbConfig) {
            try {
              const pool = await this.sqlServerService.getPool(dbConfig);
              const dbRes = await pool
                .request()
                .input('maid', sql.BigInt, maid)
                .query(
                  'SELECT TOP 50 * FROM Lawton.dbo.tblmaClaimDetails WITH(NOLOCK) WHERE MA_benefMediAssistid = @maid OR PriBenefMAID = @maid',
                );

              claims = dbRes.recordset || [];
            } catch (dbErr: any) {
              this.logger.debug(
                `No claims in DB or query failed: ${dbErr?.message}`,
                MemberService.name,
                { tenantId: normalizedTenantId, maid },
              );
            }
          }
        }
      }

      const durationMs = Date.now() - startedAt;
      this.logger.debug(
        `Member claims fetched in ${durationMs}ms (count=${claims.length}) for maid=${maid}`,
        MemberService.name,
        { tenantId: normalizedTenantId, maid, count: claims.length },
      );

      return {
        success: true,
        claims,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;
      this.logger.error(
        `Error fetching claims list after ${durationMs}ms: ${err.message}`,
        err.stack,
        MemberService.name,
        { tenantId: normalizedTenantId, maid },
      );
      return {
        success: false,
        error: 'Internal server error fetching claims',
        claims: [],
      };
    }
  }
}
