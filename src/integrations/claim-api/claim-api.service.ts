import { Injectable } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service.js';
import { LoggingService } from '../../../common/logging/logging.service.js';
import { AgentPolicySearchResponse, GroupCorpPolicyResponse } from './claim-api.types.js';

@Injectable()
export class ClaimApiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) { }

  async searchPoliciesByAgent(
    brokerId: string | number,
    allowedTPAIds: number[],
    baseUrl: string,
  ): Promise<AgentPolicySearchResponse> {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/policy/search/agentcode`;

    this.logger.debug(
      `Searching policies by agent for brokerId: ${brokerId}`,
      ClaimApiService.name,
      { brokerId, allowedTPAIds, endpoint },
    );

    const payload = {
      BrokerId: brokerId,
      MandateBrokerName: null,
      AllowedTPAIds: allowedTPAIds,
    };

    const response = await this.httpService.post<AgentPolicySearchResponse>(endpoint, payload);

    if (!response?.isSuccess) {
      this.logger.warn(
        `Agent policy search failed for brokerId: ${brokerId}`,
        ClaimApiService.name,
        { brokerId, response },
      );
      throw new Error(`Failed to fetch policies for broker: ${brokerId}`);
    }

    return response;
  }

  async searchPoliciesByGroupCorp(
    groupCorpId: number,
    tenantId: string,
    baseUrl: string,
    accessKey: string,
    showAllClaims: boolean,
  ): Promise<GroupCorpPolicyResponse> {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/api/v2/PolicySearch/.json`;

    this.logger.debug(
      `Searching policies by group corp: ${groupCorpId}`,
      ClaimApiService.name,
      { groupCorpId, tenantId, endpoint },
    );

    const payload = {
      GroupCorporateIds: [groupCorpId],
      Range: 100,
      StartIndex: 0,
    };

    const response = await this.httpService.post<GroupCorpPolicyResponse>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-CA-SHARED-KEY': accessKey,
        'Payer': tenantId,
        'LoadArchive': showAllClaims ? 'True' : 'False',
      },
    });

    return response;
  }

  async searchPolicies(corporateIds: number[], baseUrl: string, accessKey: string, tenantId: string, showAllClaims: boolean) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/api/v2/PolicySearch/.json`;

    const payload = {
      CorporateIds: corporateIds,
      Range: 100,
      StartIndex: 0,
    };

    const response = await this.httpService.post<AgentPolicySearchResponse>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-CA-SHARED-KEY': accessKey,
        'Payer': tenantId,
        'LoadArchive': showAllClaims ? 'True' : 'False',
      },
    });

    return response;
  }

  async getBeneficiaryFamily(maid: number, baseUrl: string) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}api/v2/BeneficiaryFamily/`;

    this.logger.debug(
      `Fetching beneficiary family for MAID: ${maid}`,
      ClaimApiService.name,
      { maid, endpoint },
    );

    const payload = {
      beneficiaryMediAssistId: maid,
      dbType: 'MA'
    };

    const response = await this.httpService.post<any>(endpoint, payload);

    if (!response?.isSuccess) {
      this.logger.warn(
        `Beneficiary family fetch failed for MAID: ${maid}`,
        ClaimApiService.name,
        { maid, response },
      );
      throw new Error(`Failed to fetch beneficiary family for MAID: ${maid}`);
    }

    return response;
  }

  /**
   * Resolves fallback corporate IDs when agent policy headers are empty or default.
   * Shared across Broker and HR modules.
   */
  async resolveFallbackCorpIds(
    tenantId: string,
    user: { brokerId?: string | number; providerGroupCorpId?: string | number },
    tenantConfig: { config?: { claimApis?: { v2?: string; v2Key?: string } } },
    isLawton: boolean,
  ): Promise<number[]> {
    const LAWTON_FALLBACK_CORP_IDS = [
      1422143, 1422123, 1422130, 1422104, 1422138, 1422145, 1422136, 1422147, 1422146, 1422144,
    ];
    const DEFAULT_BROKER_ID = '120';
    const DEFAULT_FALLBACK_CORP_ID = 1041805;

    if (isLawton || String(user.brokerId) === DEFAULT_BROKER_ID) {
      this.logger.debug(
        `Using Lawton / default fallback corporate IDs`,
        ClaimApiService.name,
        { tenantId, brokerId: user.brokerId },
      );
      return [...LAWTON_FALLBACK_CORP_IDS];
    }

    const groupCorpId = Number(user.providerGroupCorpId || 0);
    const resolvedIds = new Set<number>();

    const v2Url = tenantConfig.config?.claimApis?.v2;
    const v2Key = tenantConfig.config?.claimApis?.v2Key || '';

    if (groupCorpId > 0 && v2Url) {
      try {
        const groupCorpResponse = await this.searchPoliciesByGroupCorp(
          groupCorpId,
          tenantId,
          v2Url,
          v2Key,
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
          ClaimApiService.name,
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