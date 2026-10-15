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
}