import { Injectable } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service.js';
import { LoggingService } from '../../../common/logging/logging.service.js';
import { AgentPolicySearchResponse, GroupCorpPolicyResponse } from './claim-api.types.js';
import { TenantConfigTypes } from '../../tenant/tenant.types.js';

@Injectable()
export class ClaimApiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) { }

  async searchPoliciesByAgent(
    brokerId: string | number,
    allowedTPAIds: string[] | number[],
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

    return Array.from(resolvedIds);
  }

  async searchClaims(
    baseUrl: string,
    tenantConfig: TenantConfigTypes,
    searchRequest: any,
    role: string,
  ) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/api/v2/ClaimSearch/.json/`;

    // Safely resolve DNSHostName by matching role, falling back to first domain or empty string
    const matchedDomain =
      tenantConfig.domains?.find(
        (domain) => domain?.portal?.toLowerCase() === role?.toLowerCase(),
      ) || tenantConfig.domains?.[0];
    const dnsHostName = matchedDomain?.host || '';

    const allowedTPAIds =
      tenantConfig.config?.additionalConfigs?.allowedTPAIds || '';

    const accessKey = tenantConfig.config?.claimApis?.v2Key || '';
    const tenantId = tenantConfig.tenantId || '';

    this.logger.debug('Searching claims', ClaimApiService.name, {
      endpoint,
      ...searchRequest,
      dnsHostName,
      role,
    });

    const payload = {
      DNSHostName: dnsHostName,
      AllowedTPAIds: allowedTPAIds,
      ...searchRequest,
      Range: 100,
      StartIndex: 0,
    };

    const response = await this.httpService.post<any>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(accessKey ? { 'X-CA-SHARED-KEY': accessKey } : {}),
        ...(tenantId ? { Payer: tenantId } : {}),
      },
    });

    if (!response?.isSuccess) {
      this.logger.warn('Claim search failed or returned unsuccessful', ClaimApiService.name, {
        endpoint,
        response,
      });

      return { isSuccess: false, claimSearchResults: [] };
    }

    return response;
  }

  async searchBeneficiaries(payload: any, baseUrl: string, accessKey: string, tenantId: string, showAllClaims: boolean) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/api/v2/BeneficiarySearch/.json`;

    this.logger.debug('Searching beneficiaries', ClaimApiService.name, {
      endpoint,
      tenantId,
      payload,
    });

    const response = await this.httpService.post<AgentPolicySearchResponse>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-CA-SHARED-KEY': accessKey,
        'Payer': tenantId,
        'LoadArchive': showAllClaims ? 'True' : 'False',
      },
    });

    this.logger.debug('Searched beneficiaries successfully', ClaimApiService.name, {
      endpoint,
      tenantId,
      hasResponse: Boolean(response),
    });

    return response;
  }

  async fetchMemberPolicyDetails(baseUrl: string, payload: any, accessKey: string, tenantId: string) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/FetchMemberPolicyDeatils`;

    this.logger.debug('Fetching member policy details', ClaimApiService.name, {
      endpoint,
      tenantId,
      payload,
    });

    try {
      const response = await this.httpService.post<any>(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': accessKey,
          'Payer': tenantId,
        },
      });

      this.logger.debug('Fetched member policy details successfully', ClaimApiService.name, {
        endpoint,
        tenantId,
        hasResponse: Boolean(response),
      });

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to fetch member policy details: ${err.message}`,
        err.stack,
        ClaimApiService.name,
        { endpoint, tenantId, payload },
      );
      throw error;
    }
  }

  async fetchPolicyDetails(baseUrl: string, payload: any, accessKey: string, tenantId: string) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/FetchPolicyDetails`;

    this.logger.debug('Fetching policy details', ClaimApiService.name, {
      endpoint,
      tenantId,
      payload,
    });

    try {
      const response = await this.httpService.post<any>(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': accessKey,
          'Payer': tenantId,
        },
      });

      this.logger.debug('Fetched policy details successfully', ClaimApiService.name, {
        endpoint,
        tenantId,
        hasResponse: Boolean(response),
      });

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to fetch policy details: ${err.message}`,
        err.stack,
        ClaimApiService.name,
        { endpoint, tenantId, payload },
      );
      throw error;
    }
  }

  async getPolicyDocuments(baseUrl: string, accessKey: string, tenantId: string, payload: any) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/api/v2/policy/attachments/`;

    this.logger.debug('Fetching policy documents', ClaimApiService.name, {
      endpoint,
      tenantId,
      payload,
    });

    try {
      const response = await this.httpService.post<any>(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': accessKey,
          'Payer': tenantId,
          'LoadArchive': 'False',
        },
      });

      this.logger.debug('Fetched policy documents successfully', ClaimApiService.name, {
        endpoint,
        tenantId,
        hasResponse: Boolean(response),
      });

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to fetch policy documents: ${err.message}`,
        err.stack,
        ClaimApiService.name,
        { endpoint, tenantId, payload },
      );
      throw error;
    }
  }

  async getAllMaidsForCorps(baseUrl: string, accessKey: string, tenantId: string, corpIds: number[], nameFilter?: string, codeFilter?: string): Promise<number[]> {
    const PAGE_SIZE = 100;
    const queries: string[] = [];
    const allMaids = new Set<number>();

    // Determine search queries: if multi-word name, search with the full name as well as individual tokens
    if (nameFilter && nameFilter.trim()) {
      const trimmed = nameFilter.trim();
      queries.push(trimmed);
      const tokens = trimmed.split(/\s+/).filter(t => t.length >= 2);
      if (tokens.length > 1) {
        // Add the last token (surname) and first token (given name) if distinct
        const lastToken = tokens[tokens.length - 1];
        const firstToken = tokens[0];
        if (!queries.includes(lastToken)) queries.push(lastToken);
        if (!queries.includes(firstToken)) queries.push(firstToken);
      }
    } else {
      queries.push('');
    }

    for (const q of queries) {
      let startIndex = 0;
      let pageCount = 0;
      let hasMore = true;
      const MAX_PAGES = (q || codeFilter) ? 2 : 1;

      while (hasMore && pageCount < MAX_PAGES) {
        pageCount++;
        const payload: any = {
          PolicyCorpIds: corpIds,
          EmployeeNo: codeFilter || '',
          BeneficiaryName: q,
          Range: PAGE_SIZE,
          StartIndex: startIndex,
        };

        try {
          const res = await this.searchBeneficiaries(payload, baseUrl, accessKey, tenantId, false);
          const benefs: any = res?.BeneficiaryDetails || res?.beneficiaryDetails || [];
          benefs.forEach((b: any) => {
            const maid = Number(b.benefMediAssistID || b.BenefMediAssistID || 0);
            if (maid > 0) allMaids.add(maid);
          });
          this.logger.debug(
            `getAllMaidsForCorps (query="${q}") page StartIndex=${startIndex}: got ${benefs.length} beneficiaries`,
            ClaimApiService.name,
          );
          if (benefs.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            startIndex += PAGE_SIZE;
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(
            `getAllMaidsForCorps query="${q}" page failed, stopping pagination: ${err.message}`,
            ClaimApiService.name,
          );
          hasMore = false;
        }
      }
    }

    this.logger.debug(
      `getAllMaidsForCorps: collected ${allMaids.size} unique MAIDs for ${corpIds.length} corps`,
      ClaimApiService.name,
    );
    return Array.from(allMaids);
  }
}