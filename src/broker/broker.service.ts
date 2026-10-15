import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { UserSessionPayload } from '../auth/auth.types.js';
import type { Request as ExpressRequest } from 'express';
import {
  BankAccountItem,
  BankAccountsResponse,
  Beneficiaries,
  ClaimDateResponse,
  CountryMasterItem,
  CountryResponse,
  DashboardResponse,
  SaveBankDetailsResponse,
  UploadClaimDocumentResponse,
  UploadedMulterFile,
} from './broker.types.js';
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
import { CountryApiService } from '../integrations/country-api/country-api.service.js';
import { BankApiService } from '../integrations/bank-api/bank-api.service.js';
import { GetFormFieldDto } from './dto/form-field.dto.js';
import { randomUUID } from 'crypto';

@Injectable()
export class BrokerService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly claimApiService: ClaimApiService,
    private readonly logger: LoggingService,
    private readonly sqlServerService: SqlServerService,
    private readonly countryApiService: CountryApiService,
    private readonly bankApiService: BankApiService
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

  async getCountries(tenantId: string, user: UserSessionPayload): Promise<CountryResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();
    const logContext = { tenantId: trimmedTenantId, userId: user.userId };

    this.logger.log('Fetching countries list for tenant', BrokerService.name, logContext);

    try {
      const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(trimmedTenantId);
      const claimV3Api = tenantConfig.config.claimApis?.v3?.replace(/\/+$/, '');
      const claimV3PairKey = tenantConfig.config.claimApis?.pairKey?.replace(/\/+$/, '');

      if (!claimV3Api || !claimV3PairKey) {
        this.logger.error(
          `Country API URL (claimApis.v3 or pairKey) is not configured for tenant: ${trimmedTenantId}`,
          undefined,
          BrokerService.name,
          logContext,
        );
        throw new InternalServerErrorException('Country API is not configured for this tenant');
      }

      const response = await this.countryApiService.getCountries(claimV3Api, claimV3PairKey, trimmedTenantId);
      const countryMasters: CountryMasterItem[] =
        response?.countryMasters ||
        response?.CountryMasters ||
        response?.countryList ||
        response?.CountryList ||
        [];
      const durationMs = Date.now() - startedAt;

      this.logger.log(
        `Successfully fetched ${countryMasters.length} countries in ${durationMs}ms`,
        BrokerService.name,
        { ...logContext, count: countryMasters.length, durationMs },
      );

      return {
        countryMasters,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Failed to fetch countries after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        { ...logContext, durationMs },
      );

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(err.message || 'Failed to fetch countries');
    }
  }

  async getBankAccounts(
    tenantId: string,
    user: UserSessionPayload,
    req: ExpressRequest,
    paramEntityId?: string,
  ): Promise<BankAccountsResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();
    const rawId =
      paramEntityId ||
      req.params?.['entityId'] ||
      (req.body as any)?.entityId ||
      (req.body as any)?.entaityId ||
      (req.query as any)?.entityId ||
      0;
    const entityId = Number(rawId);

    const logContext = {
      tenantId: trimmedTenantId,
      userId: user.userId,
      entityId,
      rawId,
    };

    if (!entityId || entityId <= 0) {
      this.logger.debug(
        'Empty or invalid entityId provided for bank accounts lookup; returning empty list',
        BrokerService.name,
        logContext,
      );
      return {
        isSuccess: true,
        accounts: [],
      };
    }

    this.logger.log('Fetching bank accounts for entity', BrokerService.name, logContext);

    try {
      const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
      const bankApiUrl = tenantConfig.config.claimApis?.v3?.replace(/\/+$/, '');
      const bankApiKey = tenantConfig.config.claimApis?.v2Key?.replace(/\/+$/, '');

      if (!bankApiUrl || !bankApiKey) {
        this.logger.error(
          `Bank API URL (claimApis.v3 or v2Key) is not configured for tenant: ${trimmedTenantId}`,
          undefined,
          BrokerService.name,
          logContext,
        );
        throw new InternalServerErrorException('Bank API is not configured for this tenant');
      }

      let response = await this.bankApiService.getBankAccounts(
        bankApiUrl,
        bankApiKey,
        entityId,
        trimmedTenantId,
      );

      // If no accounts found, the ID passed might be a MAID (e.g. 6000127656) or PIH suffix instead of BenefUserID
      if (!response?.accountDetailsGroup?.length) {
        const dbConfig = tenantConfig.config?.database;

        if (dbConfig) {
          const dbStart = Date.now();
          try {
            const pool = await this.sqlServerService.getPool(dbConfig);
            const row = await pool
              .request()
              .input('id', entityId)
              .query(
                `SELECT TOP 1 BenefUserID
                 FROM Lawton.dbo.tblmabeneficiary WITH(NOLOCK)
                 WHERE BenefMediAssistID = @id OR BenefNIAPersonID = CAST(@id AS VARCHAR(50)) OR BenefNIAPersonID LIKE '%' + CAST(@id AS VARCHAR(50))`,
              );

            if (row.recordset?.length > 0 && Number(row.recordset[0].BenefUserID) !== entityId) {
              const resolvedId = Number(row.recordset[0].BenefUserID);
              this.logger.debug(
                `Resolved BenefUserID fallback ${resolvedId} from DB in ${Date.now() - dbStart}ms; retrying bank API`,
                BrokerService.name,
                { ...logContext, resolvedId },
              );

              const retryResp = await this.bankApiService.getBankAccounts(
                bankApiUrl,
                bankApiKey,
                resolvedId,
                trimmedTenantId,
              );

              if (retryResp?.accountDetailsGroup?.length) {
                response = retryResp;
              }
            }
          } catch (dbErr) {
            const err = dbErr instanceof Error ? dbErr : new Error(String(dbErr));
            this.logger.warn(
              `Failed resolving BenefUserID fallback from DB for bank accounts: ${err.message}`,
              BrokerService.name,
              logContext,
            );
          }
        }
      }

      const accounts: BankAccountItem[] = [];

      if (response?.isSuccess && Array.isArray(response.accountDetailsGroup)) {
        for (const group of response.accountDetailsGroup) {
          if (!Array.isArray(group.accountDetails)) continue;

          const details: Record<string, string> = {};
          for (const a of group.accountDetails) {
            if (a.isActive !== false && a.key) {
              details[a.key] = a.value ?? '';
            }
          }
          accounts.push({ data: details, groupingKey: group.groupingKey });
        }
      }

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Successfully fetched ${accounts.length} bank accounts in ${durationMs}ms`,
        BrokerService.name,
        { ...logContext, count: accounts.length, durationMs },
      );

      return {
        isSuccess: true,
        accounts,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Failed fetching bank accounts after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        { ...logContext, durationMs },
      );

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      return {
        isSuccess: false,
        accounts: [],
        error: 'Failed to retrieve bank accounts',
      };
    }
  }

  async getBankformField(tenantId: string, user: UserSessionPayload, dto: GetFormFieldDto) {
    const trimmedTenantId = tenantId.trim();
    try {
      const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
      const bankApiUrl = tenantConfig.config.claimApis?.v3?.replace(/\/+$/, '');
      const bankApiKey = tenantConfig.config.claimApis?.v2Key?.replace(/\/+$/, '');
      if (!bankApiUrl || !bankApiKey) {
        throw new InternalServerErrorException('Bank API is not configured for this tenant');
      }

      const fields = await this.bankApiService.getBankFormFields(bankApiUrl, bankApiKey, trimmedTenantId, dto.countryShortName || '', dto.country2DigitCode || '', dto.currency || '');
      return {
        isSuccess: true,
        fields,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      this.logger.error(
        `Failed fetching bank form fields: ${err.message}`,
        err.stack,
        BrokerService.name,
      );

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      return {
        isSuccess: false,
        fields: [],
        error: 'Failed to retrieve bank form fields',
      };
    }
  }

  async saveBankDetails(
    tenantId: string,
    user: UserSessionPayload,
    dto: any,
  ): Promise<SaveBankDetailsResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();
    let payload = dto;

    // Parse requestJson if it contains a JSON string.
    if (payload?.requestJson && typeof payload.requestJson === 'string') {
      try {
        payload = JSON.parse(payload.requestJson);
      } catch {
        // Retain original payload if parsing fails
      }
    }

    if (payload?.entityId) {
      payload.entityId = Math.min(Number(payload.entityId), 2147483647);
    }

    const logContext = {
      tenantId: trimmedTenantId,
      userId: user.userId,
      entityId: payload?.entityId,
    };

    this.logger.log('Saving bank details', BrokerService.name, logContext);

    try {
      const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
      const bankApiUrl = tenantConfig.config.claimApis?.v3?.replace(/\/+$/, '');
      const bankApiKey = tenantConfig.config.claimApis?.v2Key?.replace(/\/+$/, '');

      if (!bankApiUrl || !bankApiKey) {
        this.logger.error(
          `Bank API URL (claimApis.v3 or v2Key) is not configured for tenant: ${trimmedTenantId}`,
          undefined,
          BrokerService.name,
          logContext,
        );
        throw new InternalServerErrorException('Bank API is not configured for this tenant');
      }

      const response = await this.bankApiService.saveBankDetails(
        bankApiUrl,
        bankApiKey,
        trimmedTenantId,
        payload,
      );

      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Successfully processed save bank details in ${durationMs}ms`,
        BrokerService.name,
        { ...logContext, durationMs, isSuccess: response?.isSuccess },
      );

      return {
        isSuccess: response?.isSuccess ?? true,
        groupingKey: response?.groupingKey || `GK_${Date.now()}`,
        error: response?.errorMsg || response?.message,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Error saving bank details after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        { ...logContext, durationMs },
      );

      // Preserves existing fallback behavior by generating a groupingKey
      return {
        isSuccess: true,
        groupingKey: `GK_${Date.now()}`,
        error: err.message,
      };
    }
  }

  async uploadClaimDocument(
    tenantId: string,
    user: UserSessionPayload,
    file?: UploadedMulterFile,
  ): Promise<UploadClaimDocumentResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();

    if (!file) {
      this.logger.warn(
        'Upload claim document failed: no file attached in multipart request',
        BrokerService.name,
        { tenantId: trimmedTenantId, userId: user.userId },
      );
      throw new BadRequestException('No file uploaded');
    }

    const logContext = {
      tenantId: trimmedTenantId,
      userId: user.userId,
      fileName: file.originalname,
      fileSize: file.size,
      mimetype: file.mimetype,
    };

    this.logger.log('Processing uploaded claim document', BrokerService.name, logContext);

    try {
      const fileGUID = randomUUID();
      const durationMs = Date.now() - startedAt;

      this.logger.log(
        `Successfully generated document GUID ${fileGUID} in ${durationMs}ms`,
        BrokerService.name,
        { ...logContext, fileGUID, durationMs },
      );

      return {
        isSuccess: true,
        fileGUID,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Error uploading claim document after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        { ...logContext, durationMs },
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      return {
        isSuccess: false,
        error: 'Failed to upload claim document',
      };
    }
  }

  async searchDiagnosis(
    tenantId: string,
    user: UserSessionPayload,
    term?: string,
  ) {
    const startedAt = Date.now();
    const trimmedTenantId = String(tenantId || '').trim();
    const trimmedTerm = String(term || '').trim();

    this.logger.log(
      `Diagnosis search started`,
      BrokerService.name,
      {
        tenantId: trimmedTenantId,
        termLength: trimmedTerm.length,
      },
    );

    if (trimmedTerm.length < 2) {
      this.logger.log(
        `Diagnosis search skipped: search term must contain at least 2 characters`,
        BrokerService.name,
        {
          tenantId: trimmedTenantId,
          termLength: trimmedTerm.length,
          durationMs: Date.now() - startedAt,
        },
      );

      return { isSuccess: true, codes: [] };
    }

    try {
      const tenantConfig =
        await this.tenantService.getFullTenantById(trimmedTenantId);

      if (!tenantConfig) {
        this.logger.error(
          `Tenant configuration not found`,
          undefined,
          BrokerService.name,
          {
            tenantId: trimmedTenantId,
            durationMs: Date.now() - startedAt,
          },
        );

        throw new InternalServerErrorException('Tenant not found');
      }

      const dbConfig = tenantConfig.config?.database;

      if (!dbConfig) {
        this.logger.error(
          `Database configuration missing for diagnosis search`,
          undefined,
          BrokerService.name,
          {
            tenantId: trimmedTenantId,
            durationMs: Date.now() - startedAt,
          },
        );

        return {
          isSuccess: false,
          codes: [],
          error: 'Database configuration not found',
        };
      }

      try {
        const pool = await this.sqlServerService.getPool(dbConfig);

        const row = await pool
          .request()
          .input('term', `%${trimmedTerm}%`)
          .query(`
          SELECT DISTINCT TOP 20
            IcdCode AS code,
            ICD_Block_Name AS description,
            IcdGroup AS groupName
          FROM Lawton.dbo.rpttblmaIcdcode
          WHERE IcdCode LIKE @term
             OR ICD_Block_Name LIKE @term
             OR IcdGroup LIKE @term
          ORDER BY description ASC
        `);

        const codes = (row.recordset || []).map((r: any) => ({
          code: r.code || '',
          description: r.description || r.groupName || r.code || '',
          groupName: r.groupName || '',
        }));

        const durationMs = Date.now() - startedAt;

        this.logger.log(
          `Diagnosis search completed successfully`,
          BrokerService.name,
          {
            tenantId: trimmedTenantId,
            resultCount: codes.length,
            durationMs,
          },
        );

        return { isSuccess: true, codes };
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error(String(error));

        this.logger.error(
          `Database error during diagnosis search: ${err.message}`,
          err.stack,
          BrokerService.name,
          {
            tenantId: trimmedTenantId,
            durationMs: Date.now() - startedAt,
          },
        );

        return {
          isSuccess: false,
          codes: [],
          error: 'Failed to search diagnosis',
        };
      }
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));

      const durationMs = Date.now() - startedAt;

      this.logger.error(
        `Diagnosis search failed after ${durationMs}ms: ${err.message}`,
        err.stack,
        BrokerService.name,
        {
          tenantId: trimmedTenantId,
          durationMs,
        },
      );

      return {
        isSuccess: false,
        codes: [],
        error: 'Failed to search diagnosis',
      };
    }
  }
}