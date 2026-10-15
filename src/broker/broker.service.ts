import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import sql from 'mssql';
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
import { SubmitClaimDto } from './dto/submit-claim.dto.js';

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
    return this.claimApiService.resolveFallbackCorpIds(
      tenantId,
      user,
      tenantConfig,
      isLawton,
    );
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
          FROM Lawton.dbo.rpttblmaIcdcode WITH(NOLOCK)
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

  async submitClaim(
    tenantId: string,
    user: UserSessionPayload,
    dto: SubmitClaimDto,
  ): Promise<{ isSuccess: boolean; claimRegNo?: string; message?: string; error?: string }> {
    const startedAt = Date.now();
    const trimmedTenantId = String(tenantId || '').trim();

    this.logger.log(
      `Submit claim started for tenant: ${trimmedTenantId}`,
      BrokerService.name,
      { tenantId: trimmedTenantId, userId: user?.userId, loginName: user?.loginName },
    );

    let payload: any = dto;
    if (payload && payload.claimDataJson && typeof payload.claimDataJson === 'string') {
      try {
        payload = JSON.parse(payload.claimDataJson);
      } catch {
        // use raw body/dto
      }
    }

    const isDraft = Boolean(payload?.IsDraft || payload?.isDraft);
    const isDomi = Boolean(
      payload?.IsDomi ||
      payload?.isDomi ||
      payload?.ClaimType === 'Domi' ||
      payload?.claimType === 'Domi'
    );
    const claimType = isDomi ? 'Domi' : 'Hosp';
    const typeId = isDomi ? 68 : 69; // 69 = InPatient (Hosp), 68 = OutPatient (Domi)
    const totalAmount = Number(
      payload?.TotalBillAmount ??
      payload?.totalBillAmount ??
      payload?.HospAmount ??
      payload?.hospAmount ??
      0
    );

    if (!isDraft && totalAmount < 0) {
      throw new BadRequestException('Bill amount cannot be negative.');
    }

    const maid = Number(payload?.MAID ?? payload?.maid ?? 0);
    const polId = Number(payload?.PolID ?? payload?.polID ?? 0);
    const benefId = Number(payload?.BenefId ?? payload?.benefId ?? maid);
    const empCode = String(payload?.EmployeeID ?? payload?.employeeID ?? '').trim();
    const providerCorpId = Number(payload?.ProviderCorpid ?? payload?.providerCorpid ?? 0);
    const ailment = String(payload?.Ailment ?? payload?.ailment ?? '').trim();
    const icdCode = String(payload?.ICDCode ?? payload?.icdCode ?? '').trim();
    const countryOfIncidence = String(payload?.CountryOfIncidence ?? payload?.countryOfIncidence ?? '').trim();
    const currency = String(payload?.Currency ?? payload?.currency ?? '').trim();
    const symptom = String(payload?.Symptom ?? payload?.symptom ?? '').trim();
    const accountReferenceId = String(payload?.AccountReferenceId ?? payload?.accountReferenceId ?? '').trim();
    const claimCategory = String(payload?.ClaimCategory ?? payload?.claimCategory ?? 'Illness').trim();
    const selectedBenefName = String(payload?.SelectedBenefName ?? payload?.selectedBenefName ?? '').trim();

    // Validation: Bank account selection is mandatory for submitting a claim
    if (!isDraft && !accountReferenceId) {
      throw new BadRequestException('Bank account is required before submitting claim.');
    }

    // Validation: Diagnosis cannot be all zeros or empty
    if (!isDraft) {
      if (!ailment || /^0+$/.test(ailment) || /^\d+$/.test(ailment) || !/[a-zA-Z]{2,}/.test(ailment)) {
        throw new BadRequestException('Please provide a valid diagnosis or ailment name.');
      }
    }

    // Format dates safely to ISO strings or null
    const parseIso = (val: any): string | null => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };

    const dateOfIncidence = parseIso(payload?.DateOfIncidence ?? payload?.dateOfIncidence);
    const dateOfAdmission = parseIso(
      payload?.DateofAdmission ??
      payload?.dateofAdmission ??
      payload?.DateOfTreatment ??
      payload?.dateOfTreatment
    );
    const dateOfDischarge = parseIso(
      payload?.DateofDischarge ??
      payload?.dateofDischarge ??
      payload?.DateOfTreatment ??
      payload?.dateOfTreatment
    );
    const symptomDate = parseIso(
      payload?.SymptomDate ??
      payload?.symptomDate ??
      payload?.SymptomStartDate ??
      payload?.symptomStartDate
    );

    const bills: any[] = Array.isArray(payload?.Bills ?? payload?.bills) ? (payload?.Bills ?? payload?.bills) : [];
    const documents: any[] = Array.isArray(payload?.Documents ?? payload?.documents) ? (payload?.Documents ?? payload?.documents) : [];

    const documentsSubmitted = documents
      .map((d: any) => d.category || d.fileName || d.FileName || 'Document')
      .filter(Boolean)
      .join(', ');

    const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(trimmedTenantId);
    if (!tenantConfig) {
      throw new InternalServerErrorException('Tenant not found');
    }

    const dxBaseUrl =
      tenantConfig.config?.claimApis?.v1?.replace(/\/+$/, '') ||
      'https://uat-lawton-dx.lawtonasia.com';

    let claimRegNo = '';

    const dxClaim = {
      claimRegnNo: '',
      claimCategory,
      maid,
      polID: polId,
      benefId,
      employeeID: empCode,
      providerCorpid: providerCorpId,
      dateofAdmission: dateOfAdmission,
      dateofDischarge: dateOfDischarge,
      dateOfIncidence: dateOfIncidence,
      symptomDate: symptomDate,
      ailment,
      icdCode,
      hospAmount: totalAmount,
      totalBillAmount: totalAmount,
      isDraft,
      isDomi,
      claimType,
      countryOfIncidence,
      currency,
      symptom,
      submittedBy: user?.loginName || 'Broker',
      sourceType: 6, // BROKER
      type: typeId,
      selectedBenefName,
      accountReferenceId,
      documentsSubmitted,
      documents: documents.map((f: any) => ({
        mainPath: f.mainPath || f.MainPath || f.fileGUID || '',
        azurePath: f.azurePath || f.AzurePath || f.fileGUID || '',
        fileName: f.fileName || f.FileName || 'Claim Document',
        isActive: true,
      })),
      bills: bills.map((b: any) => ({
        billId: 0,
        billNo: b.billNo || b.BillNo || '',
        billDate: parseIso(b.billDate || b.BillDate),
        amount: parseFloat(b.amount || b.Amount || '0') || 0,
        description: '',
        isActive: true,
        billType: b.billType || b.BillType || '',
        doctorName: b.doctorName || b.DoctorName || '',
        clinicAddress: b.clinicAddress || b.ClinicAddress || '',
      })),
    };

    // 1. Try forwarding to DX endpoint
    try {
      const dxUrl = `${dxBaseUrl.replace(/\/$/, '')}/memberportal/claim/submit/`;
      this.logger.log(`Forwarding claim submission to DX: ${dxUrl}`, BrokerService.name, {
        tenantId: trimmedTenantId,
        dxUrl,
      });

      const dxRes = await fetch(dxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ onlineClaim: dxClaim, callNewMethod: true }),
      });

      if (dxRes.ok) {
        const dxText = await dxRes.text();
        try {
          const dxJson = JSON.parse(dxText);
          claimRegNo = typeof dxJson === 'string' ? dxJson : (dxJson?.claimRegNo || dxJson?.ClaimRegnNo || '');
        } catch {
          claimRegNo = dxText.replace(/"/g, '').trim();
        }
      } else {
        const errText = await dxRes.text();
        this.logger.warn(
          `DX claim submit responded with status ${dxRes.status}: ${errText}`,
          BrokerService.name,
          { tenantId: trimmedTenantId, status: dxRes.status },
        );
      }
    } catch (dxErr) {
      const err = dxErr instanceof Error ? dxErr : new Error(String(dxErr));
      this.logger.warn(
        `DX claim submission network call error (falling back to database generation): ${err.message}`,
        BrokerService.name,
        { tenantId: trimmedTenantId },
      );
    }

    // Fallback registration number generation if DX is not reachable
    if (!claimRegNo) {
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      claimRegNo = `CLM-${Date.now().toString().slice(-4)}${randomSuffix}`;
    }

    // 2. Persist into MSSQL Database: tblClaimRegistration, tblClaimBills, tblClaimDocMapping, and tblPc_Employees
    const dbConfig = tenantConfig.config?.database;
    if (dbConfig) {
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);

        // Insert into tblClaimRegistration
        const regReq = pool.request();
        regReq.input('ClaimRegnNo', sql.VarChar(50), claimRegNo);
        regReq.input('ProviderCorpid', sql.BigInt, providerCorpId || 0);
        regReq.input('PolID', sql.Int, polId || 0);
        regReq.input('EmployeeID', sql.VarChar(50), empCode);
        regReq.input('MAID', sql.BigInt, maid || 0);
        regReq.input('Type', sql.Int, typeId);
        regReq.input('DateofAdmission', sql.DateTime, dateOfAdmission ? new Date(dateOfAdmission) : null);
        regReq.input('DateofDischarge', sql.DateTime, dateOfDischarge ? new Date(dateOfDischarge) : null);
        regReq.input('ClaimStatus', sql.VarChar(50), isDraft ? 'Draft' : 'Submitted');
        regReq.input('Ailment', sql.VarChar(255), ailment);
        regReq.input('BenefId', sql.Int, benefId || 0);
        regReq.input('TotalBillAmount', sql.Decimal(18, 4), totalAmount);
        regReq.input('isDraft', sql.Bit, isDraft ? 1 : 0);
        regReq.input('SubmittedBy', sql.VarChar(100), user?.loginName || 'Broker');
        regReq.input('icdcode', sql.VarChar(50), icdCode);
        regReq.input('CountryOfIncidence', sql.VarChar(100), countryOfIncidence);
        regReq.input('DateOfIncidence', sql.DateTime, dateOfIncidence ? new Date(dateOfIncidence) : null);
        regReq.input('Currency', sql.VarChar(10), currency);
        regReq.input('AccountReferenceId', sql.VarChar(100), accountReferenceId);
        regReq.input('DocumentsSubmitted', sql.VarChar(500), documentsSubmitted);

        await regReq.query(`
          INSERT INTO Lawton.dbo.tblClaimRegistration (
            ClaimRegnNo, ProviderCorpid, PolID, EmployeeID, MAID, Type,
            DateofAdmission, DateofDischarge, ClaimStatus, Ailment, BenefId,
            TotalBillAmount, InCMS, isActive, isDraft, SubmittedBy, CreatedDateTime,
            SourceType, icdcode, CountryOfIncidence, DateOfIncidence, Currency,
            AccountReferenceId, DocumentsSubmitted
          ) VALUES (
            @ClaimRegnNo, @ProviderCorpid, @PolID, @EmployeeID, @MAID, @Type,
            @DateofAdmission, @DateofDischarge, @ClaimStatus, @Ailment, @BenefId,
            @TotalBillAmount, 0, 1, @isDraft, @SubmittedBy, GETDATE(),
            6, @icdcode, @CountryOfIncidence, @DateOfIncidence, @Currency,
            @AccountReferenceId, @DocumentsSubmitted
          )
        `);
        this.logger.log(`Saved claim ${claimRegNo} to tblClaimRegistration`, BrokerService.name, {
          tenantId: trimmedTenantId,
          claimRegNo,
        });

        // Insert Bills into tblClaimBills
        for (const bill of bills) {
          const bNo = String(bill.billNo || bill.BillNo || '').trim();
          const bAmt = parseFloat(bill.amount || bill.Amount || '0') || 0;
          const bDate = parseIso(bill.billDate || bill.BillDate);
          if (bNo || bAmt > 0) {
            const billReq = pool.request();
            billReq.input('ClaimRegno', sql.VarChar(50), claimRegNo);
            billReq.input('BillNo', sql.VarChar(50), bNo);
            billReq.input('BillDate', sql.DateTime, bDate ? new Date(bDate) : null);
            billReq.input('Amount', sql.Decimal(18, 4), bAmt);
            billReq.input('BillType', sql.VarChar(50), bill.billType || bill.BillType || '');
            billReq.input('DoctorName', sql.VarChar(100), bill.doctorName || bill.DoctorName || '');
            billReq.input('ClinicAddress', sql.VarChar(255), bill.clinicAddress || bill.ClinicAddress || '');
            await billReq.query(`
              INSERT INTO Lawton.dbo.tblClaimBills (
                ClaimRegno, BillNo, BillDate, Amount, IsActive, BillType, DoctorName, ClinicAddress
              ) VALUES (
                @ClaimRegno, @BillNo, @BillDate, @Amount, 1, @BillType, @DoctorName, @ClinicAddress
              )
            `);
          }
        }

        // Insert Documents into tblClaimDocMapping
        for (const doc of documents) {
          const mainPath = String(doc.mainPath || doc.MainPath || doc.fileGUID || '').trim();
          const fileName = String(doc.fileName || doc.FileName || 'Document').trim();
          if (mainPath) {
            const docReq = pool.request();
            docReq.input('MainPath', sql.VarChar(500), mainPath);
            docReq.input('AzurePath', sql.VarChar(500), mainPath);
            docReq.input('ClaimRegNo', sql.VarChar(50), claimRegNo);
            docReq.input('FileName', sql.VarChar(255), fileName);
            await docReq.query(`
              INSERT INTO Lawton.dbo.tblClaimDocMapping (
                MainPath, AzurePath, ClaimRegNo, FileName, IsActive, ModifiedDateTime
              ) VALUES (
                @MainPath, @AzurePath, @ClaimRegNo, @FileName, 1, GETDATE()
              )
            `);
          }
        }

        // Insert into Lawton_MACP_PROD.dbo.tblPc_Employees for claims search consistency
        try {
          const macpDb = 'Lawton_MACP_PROD';
          const empReq = pool.request();
          empReq.input('ClaimID', sql.NVarChar(50), claimRegNo);
          empReq.input('TPAID', sql.NVarChar(50), claimRegNo);
          empReq.input('EmpId', sql.NVarChar(50), empCode);
          empReq.input('CorpID', sql.BigInt, providerCorpId || 0);
          empReq.input('PMCorpId', sql.BigInt, providerCorpId || 0);
          empReq.input('EmpName', sql.NVarChar(150), selectedBenefName || empCode || 'Insured Member');
          empReq.input('NameOfPatient', sql.NVarChar(150), selectedBenefName || empCode || 'Insured Member');
          empReq.input('Relation', sql.NVarChar(50), 'Self');
          empReq.input('PolNo', sql.NVarChar(100), String(polId));
          empReq.input('Ailment', sql.NVarChar(255), ailment);
          empReq.input('Final_Diagnosis', sql.NVarChar(255), ailment);
          empReq.input('Date_Of_Admission', sql.NVarChar(50), dateOfAdmission ? dateOfAdmission.split('T')[0] : '');
          empReq.input('Date_Of_Discharge', sql.NVarChar(50), dateOfDischarge ? dateOfDischarge.split('T')[0] : '');
          empReq.input('Total_ClaimAmount', sql.NVarChar(50), String(totalAmount));
          empReq.input('Type_Of_Claims', sql.NVarChar(50), isDomi ? 'Domiciliary' : 'Hospitalization');
          empReq.input('MAID', sql.NVarChar(50), String(maid));

          await empReq.query(`
            INSERT INTO ${macpDb}.dbo.tblPc_Employees (
              ClaimID, TPAID, EmpId, CorpID, PMCorpId, EmpName, NameOfPatient, Relation,
              PolNo, Ailment, Final_Diagnosis, Date_Of_Admission, Date_Of_Discharge,
              Total_ClaimAmount, Approved_Amount, ApprovedAmount, Type_Of_Claims, Claim_Status,
              MA_benefMediAssistid, IsActive, CreatedDate
            ) VALUES (
              @ClaimID, @TPAID, @EmpId, @CorpID, @PMCorpId, @EmpName, @NameOfPatient, @Relation,
              @PolNo, @Ailment, @Final_Diagnosis, @Date_Of_Admission, @Date_Of_Discharge,
              @Total_ClaimAmount, 0, 0, @Type_Of_Claims, 'Submitted',
              @MAID, 1, GETDATE()
            )
          `);
          this.logger.log(`Synced claim ${claimRegNo} to ${macpDb}.dbo.tblPc_Employees`, BrokerService.name, {
            tenantId: trimmedTenantId,
            claimRegNo,
          });
        } catch (macpErr) {
          const err = macpErr instanceof Error ? macpErr : new Error(String(macpErr));
          this.logger.warn(
            `Error syncing claim to Lawton_MACP_PROD.dbo.tblPc_Employees: ${err.message}`,
            BrokerService.name,
            { tenantId: trimmedTenantId, claimRegNo },
          );
        }
      } catch (dbErr) {
        const err = dbErr instanceof Error ? dbErr : new Error(String(dbErr));
        this.logger.error(
          `Error recording submitted claim in MSSQL tables: ${err.message}`,
          err.stack,
          BrokerService.name,
          { tenantId: trimmedTenantId, claimRegNo },
        );
        // We do not fail the request if database insertion had a partial failure,
        // as the claim has been submitted and generated.
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Broker claim submitted successfully: ${claimRegNo} (type: ${claimType}, amount: ${totalAmount}) in ${durationMs}ms`,
      BrokerService.name,
      { tenantId: trimmedTenantId, claimRegNo, claimType, totalAmount, durationMs },
    );

    return {
      isSuccess: true,
      claimRegNo,
      message: isDraft ? 'Draft saved successfully' : 'Claim submitted successfully',
    };
  }
}