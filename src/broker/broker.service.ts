import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { UserSessionPayload } from '../auth/auth.types.js';
import { Beneficiaries, ClaimDateResponse, DashboardResponse } from './broker.types.js';
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
import { parseDotNetDate } from '../../utils/date-helper.js';
import { mapAgentPolicies, mapFallbackPolicies } from '../../utils/policy.mapper.js';
import { SqlServerService } from '../database/sql-server.service.js';

@Injectable()
export class BrokerService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly claimApiService: ClaimApiService,
    private readonly logger: LoggingService,
    private readonly sqlServerService: SqlServerService,
  ) { }

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

  async getPolicyList(
    tenantId: string,
    user: UserSessionPayload,
  ) {
    const normalizedTenantId = tenantId.trim();
    const brokerId = user.brokerId || DEFAULT_BROKER_ID;
    const isLawton = normalizedTenantId === LAWTON_TENANT_ID;
    const startedAt = Date.now();

    const context = {
      tenantId: normalizedTenantId,
      brokerId,
      userId: user.userId,
    };

    this.logger.log(
      'Fetching broker policy list',
      BrokerService.name,
      context,
    );

    try {
      const tenantConfig: TenantConfigTypes =
        await this.tenantService.getFullTenantById(
          normalizedTenantId,
        );

      const claimApis = tenantConfig.config?.claimApis;
      const claimApiUrl = claimApis?.v1?.replace(/\/+$/, '');

      if (!claimApiUrl) {
        throw new InternalServerErrorException(
          'Claim API URL is not configured for this tenant.',
        );
      }

      // First attempt: agent-level policy search.
      const allowedTPAIds = isLawton ? LAWTON_TPA_IDS : [];

      const agentSearchStartedAt = Date.now();

      const agentResponse =
        await this.claimApiService.searchPoliciesByAgent(
          brokerId,
          allowedTPAIds,
          claimApiUrl,
        );

      const agentPolicies =
        agentResponse?.policyHeaders ??
        agentResponse?.PolicyHeaders ??
        [];

      if (!Array.isArray(agentPolicies)) {
        throw new InternalServerErrorException(
          'Invalid response received from agent policy search.',
        );
      }

      this.logger.log(
        'Agent policy search completed',
        BrokerService.name,
        {
          ...context,
          policyCount: agentPolicies.length,
          durationMs: Date.now() - agentSearchStartedAt,
        },
      );

      if (agentPolicies.length > 0) {
        const policies = mapAgentPolicies(agentPolicies);

        this.logger.log(
          'Broker policy list retrieved using agent search',
          BrokerService.name,
          {
            ...context,
            source: 'agent',
            policyCount: policies.length,
            durationMs: Date.now() - startedAt,
          },
        );

        return { success: true, policies };
      }

      // Second attempt: corporate-level fallback search.
      this.logger.log(
        'Agent policy search returned no policies; using corporate fallback',
        BrokerService.name,
        context,
      );

      const corpIds = await this.resolveFallbackCorpIds(
        normalizedTenantId,
        user,
        tenantConfig,
        isLawton,
      );

      const fallbackStartedAt = Date.now();

      const fallbackResponse =
        await this.claimApiService.searchPolicies(
          corpIds,
          claimApis?.v2 || '',
          claimApis?.v2Key || '',
          normalizedTenantId,
          false,
        );

      const fallbackItems =
        fallbackResponse?.policyDetails ??
        fallbackResponse?.PolicyDetails ??
        [];

      if (!Array.isArray(fallbackItems)) {
        throw new InternalServerErrorException(
          'Invalid response received from corporate policy search.',
        );
      }

      // Preserve the existing fallback expiry rule.
      const today = new Date();

      const activePolicies = fallbackItems.filter((policy) => {
        const rawEndDate =
          policy.polEndDate ??
          policy.PolEndDate ??
          policy.endDate ??
          policy.EndDate;

        if (!rawEndDate) {
          return true;
        }

        const expiryDate = parseDotNetDate(rawEndDate);

        return (
          expiryDate instanceof Date &&
          !Number.isNaN(expiryDate.getTime()) &&
          expiryDate >= today
        );
      });

      const policies = mapFallbackPolicies(activePolicies);

      this.logger.log(
        'Corporate fallback policy search completed',
        BrokerService.name,
        {
          ...context,
          corporateCount: corpIds.length,
          receivedCount: fallbackItems.length,
          activeCount: activePolicies.length,
          policyCount: policies.length,
          durationMs: Date.now() - fallbackStartedAt,
        },
      );

      this.logger.log(
        'Broker policy list retrieved',
        BrokerService.name,
        {
          ...context,
          source: 'corporate-fallback',
          policyCount: policies.length,
          durationMs: Date.now() - startedAt,
        },
      );

      return { success: true, policies };
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(String(error));

      this.logger.error(
        `Failed to fetch broker policy list: ${err.message}`,
        err.stack,
        BrokerService.name,
        {
          ...context,
          durationMs: Date.now() - startedAt,
        },
      );

      throw error;
    }
  }

  async getMemberClaimData(
    tenantId: string,
    user: UserSessionPayload,
    maid?: string,
    polId?: string,
    empCode?: string,
    corpId?: string,
    pihNumber?: string,
    name?: string,
  ): Promise<ClaimDateResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();
    const numMaid = Number(maid) || 0;
    const parsedPolId = polId ? Number(polId) : undefined;
    const parsedCorpId = corpId ? Number(corpId) : undefined;
    const resolvedEmpCode = empCode?.trim() || '';
    const logContext = {
      tenantId: trimmedTenantId,
      userId: user.userId,
      maid: numMaid,
      polId: parsedPolId,
      corpId: parsedCorpId,
      pihNumber,
    };

    this.logger.log('Fetching member claim data', BrokerService.name, logContext);

    try {
      const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(trimmedTenantId);
      let beneficiaries: Beneficiaries[] = [];

      // Step 1: Attempt to fetch beneficiary family from Claim API
      if (numMaid > 0) {
        beneficiaries = await this.fetchBeneficiaryFamilyFromApi(numMaid, tenantConfig, trimmedTenantId);
      }

      // Step 2: Fallback to SQL Server query if API returned no family members
      if (beneficiaries.length === 0) {
        this.logger.log(
          'Beneficiaries empty after API fetch; falling back to primary beneficiary resolution',
          BrokerService.name,
          logContext,
        );

        const primaryBeneficiary = await this.resolvePrimaryBeneficiaryFallback(
          numMaid,
          pihNumber,
          name,
          tenantConfig,
        );

        beneficiaries = [primaryBeneficiary];
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Successfully retrieved member claim data in ${durationMs}ms`,
        BrokerService.name,
        {
          ...logContext,
          beneficiaryCount: beneficiaries.length,
          durationMs,
        },
      );

      return {
        isSuccess: true,
        benbeneficiaries: beneficiaries,
        empCode: resolvedEmpCode,
        providerCorpId: parsedCorpId,
        polId: parsedPolId,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Error in member-claim-data after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        { ...logContext, durationMs },
      );

      return {
        isSuccess: false,
        error: 'Failed to retrieve member claim data',
      };
    }
  }

  /**
   * Fetches beneficiary family records from external Claim API.
   */
  private async fetchBeneficiaryFamilyFromApi(
    numMaid: number,
    tenantConfig: TenantConfigTypes,
    trimmedTenantId: string,
  ): Promise<Beneficiaries[]> {
    const claimApiUrl = tenantConfig.config?.claimApis?.v1?.replace(/\/+$/, '');
    if (!claimApiUrl) {
      this.logger.warn(
        `Claim API URL is not configured for tenant: ${trimmedTenantId}`,
        BrokerService.name,
        { tenantId: trimmedTenantId },
      );
      return [];
    }

    try {
      const familyRes = await this.claimApiService.getBeneficiaryFamily(numMaid, claimApiUrl);
      const list = familyRes?.beneficiaryDetails || familyRes?.BeneficiaryDetails || familyRes || [];

      if (!Array.isArray(list) || list.length === 0) {
        return [];
      }

      return list.map((b: any) => {
        const relRaw = String(b.benefRelName || b.Relation || b.relation || 'Self').trim();
        const relation = relRaw.toLowerCase() === 'self' ? 'Insured' : relRaw;

        return {
          MAID: Number(b.benefMediAssistID || b.Maid || b.MAID || numMaid),
          BenefUserId: Number(b.benefUserID || b.benefUserId || b.UserId || b.benefMediAssistID || numMaid),
          Name: [b.benefName || b.Name, b.benefLastName].filter(Boolean).join(' ') || 'Insured Member',
          Relation: relation,
          Gender: b.sex || b.Gender || b.gender || '',
          DOB: b.dob || b.DOB || '',
          PIHMemberId: b.benefNIAPersonID || b.priBenefNIAPersonID || '',
        };
      });
    } catch (familyError) {
      const err = familyError instanceof Error ? familyError : new Error(String(familyError));
      this.logger.warn(
        `Failed to fetch beneficiary family from API, falling back to database: ${err.message}`,
        BrokerService.name,
        { maid: numMaid },
      );
      return [];
    }
  }

  /**
   * Resolves primary beneficiary from database or defaults as fallback.
   */
  private async resolvePrimaryBeneficiaryFallback(
    numMaid: number,
    pihNumber: string | undefined,
    name: string | undefined,
    tenantConfig: TenantConfigTypes,
  ): Promise<Beneficiaries> {
    let resolvedUserId: number = numMaid || 1;
    let resolvedPih: string = pihNumber ? String(pihNumber).trim() : '';
    let resolvedName: string = name?.trim() || 'Insured Member';
    let resolvedGender = '';
    let resolvedDob = '';

    const dbConfig = tenantConfig.config?.database;
    const queryTarget = numMaid > 0 ? numMaid : resolvedPih;

    if (dbConfig && queryTarget) {
      const dbStart = Date.now();
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);

        const row = await pool
          .request()
          .input('id', queryTarget)
          .query(
            `SELECT TOP 1 BenefUserID, BenefMediAssistID, BenefNIAPersonID, BenefName, BenefLastName, BenefSex, BenefDOB
             FROM Lawton.dbo.tblmabeneficiary WITH(NOLOCK)
             WHERE BenefMediAssistID = @id OR BenefNIAPersonID = CAST(@id AS VARCHAR(50)) OR BenefUserID = TRY_CAST(@id AS INT)`,
          );

        if (row.recordset && row.recordset.length > 0) {
          const b = row.recordset[0];
          resolvedUserId = Number(b.BenefUserID) || resolvedUserId;
          resolvedPih = b.BenefNIAPersonID || resolvedPih;
          resolvedName = [b.BenefName, b.BenefLastName].filter(Boolean).join(' ') || resolvedName;
          resolvedGender = b.BenefSex || '';
          resolvedDob = b.BenefDOB ? String(b.BenefDOB) : '';

          this.logger.debug(
            `Resolved primary beneficiary from DB in ${Date.now() - dbStart}ms`,
            BrokerService.name,
            { queryTarget, resolvedUserId, resolvedPih },
          );
        }
      } catch (dbErr) {
        const err = dbErr instanceof Error ? dbErr : new Error(String(dbErr));
        this.logger.warn(
          `Failed resolving BenefUserID from DB in member-claim-data fallback: ${err.message}`,
          BrokerService.name,
          { queryTarget },
        );
      }
    }

    return {
      MAID: numMaid || 1,
      BenefUserId: resolvedUserId,
      Name: resolvedName,
      Relation: 'Insured',
      Gender: resolvedGender,
      DOB: resolvedDob,
      PIHMemberId: resolvedPih,
    };
  }
}