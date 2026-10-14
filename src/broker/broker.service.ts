import { Injectable } from '@nestjs/common';
import { UserSessionPayload } from '../auth/auth.types.js';
import { DashboardResponse } from './broker.types.js';
import { TenantConfigTypes } from '../tenant/tenant.types.js';
import { TenantService } from '../tenant/tenant.service.js';
import { ClaimApiService } from '../integrations/claim-api/claim-api.service.js';
import { LoggingService } from '../../common/logging/logging.service.js';
import {
  DEFAULT_BROKER_ID,
  DEFAULT_FALLBACK_CORP_ID,
  LAWTON_FALLBACK_CORP_IDS,
  LAWTON_TENANT_ID,
  LAWTON_TPA_IDS,
} from './broker.constants.js';

@Injectable()
export class BrokerService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly claimApiService: ClaimApiService,
    private readonly logger: LoggingService,
  ) {}

  async getBrokerData(tenantId: string, user: UserSessionPayload): Promise<DashboardResponse> {
    const trimmedTenantId = tenantId.trim();
    const brokerId = user.brokerId || DEFAULT_BROKER_ID;
    const isLawton = trimmedTenantId === LAWTON_TENANT_ID;

    this.logger.log(
      `Fetching broker dashboard data for brokerId: ${brokerId}`,
      BrokerService.name,
      { tenantId: trimmedTenantId, brokerId, userId: user.userId },
    );

    try {
      const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(trimmedTenantId);
      const claimApiUrl = tenantConfig.config.claimApis.v1?.replace(/\/+$/, '');

      if (!claimApiUrl) {
        this.logger.error(
          `Claim API URL is not configured for tenant: ${trimmedTenantId}`,
          undefined,
          BrokerService.name,
          { tenantId: trimmedTenantId },
        );
        throw new Error('Claim API URL is not configured for this tenant.');
      }

      const allowedTPAIds = isLawton ? LAWTON_TPA_IDS : [];
      const policiesData = await this.claimApiService.searchPoliciesByAgent(
        brokerId,
        allowedTPAIds,
        claimApiUrl,
      );

      const headers = policiesData?.policyHeaders || policiesData?.PolicyHeaders || [];
      const brokerCorpName =
        headers[0]?.PolicyHolderName ||
        headers[0]?.policyHolderName ||
        'Broker Portal';

      let corpIds = this.extractCorporateIds(headers);

      // Apply fallback resolution if no corporate IDs found or single test fallback ID
      if (corpIds.length === 0 || (corpIds.length === 1 && corpIds[0] === DEFAULT_FALLBACK_CORP_ID)) {
        corpIds = await this.resolveFallbackCorpIds(trimmedTenantId, user, tenantConfig, isLawton);
      }

      const isAdminBroker = Boolean(user.isAdminBroker);

      this.logger.log(
        `Successfully retrieved broker data for brokerId: ${brokerId}`,
        BrokerService.name,
        {
          tenantId: trimmedTenantId,
          brokerId,
          resolvedCorpCount: corpIds.length,
          primaryCorpId: corpIds[0] || 0,
        },
      );

      return {
        success: true,
        userName: user.userName || user.loginName || '',
        brokerName: brokerCorpName,
        brokerId,
        isAdminBroker,
        isLawton,
        corpId: corpIds[0] || 0,
        corpIds,
        welcomeBrandingName: isLawton ? 'LawtonAsia' : 'Mayfair We care',
        roleAccess: {
          showClaims: true,
          showSearchHospital: true,
          showPolicyDetails: true,
          showMemberEnrollment: true,
          showEcard: true,
          showProfile: true,
          showMAestroDashboard: true,
          showClaimSubmission: true,
          showPolicyList: true,
          showUserManagement: isAdminBroker,
          maestroDashboards: {
            showWebMISReport: true,
            showPADashboard: true,
          },
        },
        reportsConfig: {
          corpId: corpIds[0] || 0,
          brokerId: Number(brokerId),
          departmentId: user.departmentId || '',
          dashboards: tenantConfig.config.additionalConfigs?.brokerDashboards || [],
        },
      };
    } catch (error) {
      this.logger.error(
        `Error generating broker dashboard data: ${(error as Error).message}`,
        (error as Error).stack,
        BrokerService.name,
        { tenantId: trimmedTenantId, brokerId },
      );
      throw error;
    }
  }

  /**
   * Extracts distinct valid positive corporate IDs from policy headers.
   */
  private extractCorporateIds(headers: Array<Record<string, unknown>>): number[] {
    const ids = headers
      .map((policy) => Number(policy.CorporateId ?? policy.corporateId ?? 0))
      .filter((id) => Number.isFinite(id) && id > 0);

    return Array.from(new Set(ids));
  }

  /**
   * Resolves fallback corporate IDs when agent policy headers are empty or default.
   */
  private async resolveFallbackCorpIds(
    tenantId: string,
    user: UserSessionPayload,
    tenantConfig: TenantConfigTypes,
    isLawton: boolean,
  ): Promise<number[]> {
    if (isLawton || String(user.brokerId) === DEFAULT_BROKER_ID) {
      this.logger.debug(
        `Using Lawton / default broker fallback corporate IDs`,
        BrokerService.name,
        { tenantId, brokerId: user.brokerId },
      );
      return [...LAWTON_FALLBACK_CORP_IDS];
    }

    const groupCorpId = Number(user.providerGroupCorpId || 0);
    const resolvedIds = new Set<number>();

    if (groupCorpId > 0 && tenantConfig.config.claimApis.v2) {
      try {
        const groupCorpResponse = await this.claimApiService.searchPoliciesByGroupCorp(
          groupCorpId,
          tenantId,
          tenantConfig.config.claimApis.v2,
          tenantConfig.config.claimApis.v2Key || '',
          false,
        );

        const policies = groupCorpResponse?.policyDetails || [];
        for (const policy of policies) {
          const cid = Number(policy.pol_CorporateId ?? policy.CorporateId ?? policy.corporateId ?? 0);
          if (cid > 0) {
            resolvedIds.add(cid);
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed searching policies by group corp: ${(err as Error).message}`,
          BrokerService.name,
          { groupCorpId, tenantId },
        );
      }

      if (resolvedIds.size === 0) {
        resolvedIds.add(groupCorpId);
      }
    }

    if (resolvedIds.size === 0) {
      resolvedIds.add(DEFAULT_FALLBACK_CORP_ID);
    }

    return Array.from(resolvedIds);
  }
}