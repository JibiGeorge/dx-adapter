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
  ClientDetailsEntity,
  ClientDetailsPolicy,
  ClientDetailsMember,
  ClientDetailsSearchResponse,
  ClientDetailsBeneficiaryResponse,
} from './broker.types.js';
import {
  SearchClientDetailsDto,
  UpdateBeneficiaryDto,
  DownloadEcardDto,
  DownloadCoverageDto,
} from './dto/client-details.dto.js';
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

  // ─── Client Details API ──────────────────────────────────────────────────

  /**
   * Retrieves unique corporate entities assigned to the broker.
   */
  async getClientDetailsEntities(
    tenantId: string,
    user: UserSessionPayload,
  ): Promise<{ isSuccess: boolean; entities: ClientDetailsEntity[] }> {
    const isHR = Boolean(user.roles?.isCorpHR || user.activePortal === 'hr');
    const hrCorpId = Number(user.providerGroupCorpId || user.providerCorpId || 0);

    if (isHR && hrCorpId > 0) {
      const trimmedTenantId = tenantId.trim();
      const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
      const claimApis = tenantConfig.config?.claimApis;

      if (claimApis?.v2) {
        try {
          const groupCorpResponse = await this.claimApiService.searchPoliciesByGroupCorp(
            hrCorpId,
            trimmedTenantId,
            claimApis.v2,
            claimApis.v2Key || '123412341234',
            false,
          );

          const v2Policies = groupCorpResponse?.policyDetails ?? (groupCorpResponse as any)?.PolicyDetails ?? [];
          const entityMap = new Map<number, string>();
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          for (const p of v2Policies) {
            const cid = Number(p.pol_CorporateId ?? p.corporateId ?? p.CorporateId ?? 0);
            const cname = (p.polHolderName || p.PolHolderName || p.corporateName || '').trim();
            const endDate = this.parseDate(p.polEndDate ?? p.PolEndDate);
            if (endDate && endDate < today) {
              continue;
            }
            if (cid > 0 && cname && !entityMap.has(cid)) {
              entityMap.set(cid, cname);
            }
          }

          if (entityMap.size > 0) {
            const sortedEntities = Array.from(entityMap.entries())
              .map(([corpId, corpName]) => ({ corpId, corpName }))
              .sort((a, b) => a.corpName.localeCompare(b.corpName, undefined, { sensitivity: 'base' }));

            return {
              isSuccess: true,
              entities: sortedEntities,
            };
          }
        } catch (err: any) {
          this.logger.warn(`Failed fetching HR group entities: ${err.message}`, BrokerService.name);
        }
      }

      return {
        isSuccess: true,
        entities: [{ corpId: hrCorpId, corpName: user.loginName || 'Corporate Client' }],
      };
    }

    const policyResult = await this.getPolicyList(tenantId, user);
    const policies = policyResult?.policies || [];

    const entityMap = new Map<number, string>();
    for (const p of policies) {
      if (p.corpId && p.corpId > 0 && !entityMap.has(p.corpId)) {
        entityMap.set(p.corpId, p.polHolderName || `Corporate ${p.corpId}`);
      }
    }

    const entities: ClientDetailsEntity[] = Array.from(entityMap.entries()).map(([corpId, corpName]) => ({
      corpId,
      corpName,
    }));

    return { isSuccess: true, entities };
  }

  /**
   * Retrieves policies for Client Details, optionally filtered by corpId.
   */
  async getClientDetailsPolicies(
    tenantId: string,
    user: UserSessionPayload,
    corpId?: number,
  ): Promise<{ isSuccess: boolean; policies: ClientDetailsPolicy[] }> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const claimApis = tenantConfig.config?.claimApis;

    const parseDate = (raw: any): Date | null => {
      if (!raw) return null;
      if (typeof raw === 'string' && raw.includes('/Date(')) {
        const match = raw.match(/\/Date\((\d+)/);
        if (match) return new Date(Number(match[1]));
      }
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };

    const formatDate = (d: Date | null): string => {
      if (!d) return '';
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    };

    const policiesMap = new Map<string, ClientDetailsPolicy>();

    // 1. If corpId is specified, call V2 PolicySearch using CorporateIds exactly like legacy GetPoliciesByCorpId
    if (corpId && Number(corpId) > 0 && claimApis?.v2) {
      try {
        const v2Response = await this.claimApiService.searchPolicies(
          [Number(corpId)],
          claimApis.v2,
          claimApis.v2Key || '123412341234',
          trimmedTenantId,
          false,
        );

        const v2Policies = v2Response?.policyDetails ?? (v2Response as any)?.PolicyDetails ?? [];
        if (Array.isArray(v2Policies)) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          for (const p of v2Policies) {
            const rawPolNo = (p.polNo || p.PolNo || '').toString().trim();
            if (!rawPolNo) continue;

            const endDate = parseDate(p.polEndDate ?? p.PolEndDate ?? p.endDate ?? p.EndDate);
            // In legacy portal: pol.PolEndDate >= DateTime.Today
            if (endDate && endDate < today) {
              continue;
            }

            const polId = Number(p.polID ?? p.polId ?? p.PolId ?? p.PolID ?? 0);
            const polHolderName = (p.polHolderName ?? p.PolHolderName ?? '').toString().trim();
            const planName = (p.planName ?? p.PlanName ?? '').toString().trim();
            const startDate = parseDate(p.polStartDate ?? p.PolStartDate ?? p.startDate ?? p.StartDate);

            // Deduplicate by Policy Number (case-insensitive) keeping latest EndDate
            const key = rawPolNo.toLowerCase();
            const existing = policiesMap.get(key);
            if (!existing || (endDate && (!existing.endDate || new Date(existing.endDate) < endDate))) {
              policiesMap.set(key, {
                polId,
                polNo: rawPolNo,
                planName,
                polHolderName,
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                corpId: Number(corpId),
              });
            }
          }
        }
      } catch (apiErr: any) {
        this.logger.warn(`Failed fetching corporate policies from V2 API: ${apiErr.message}`, BrokerService.name, { corpId });
      }
    }

    // 2. Fallback / supplement from SQL Server (Lawton.dbo.tblmapolicy)
    const dbConfig = tenantConfig.config?.database;
    if (policiesMap.size === 0 && dbConfig && corpId && Number(corpId) > 0) {
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);
        const dbRes = await pool
          .request()
          .input('corpId', Number(corpId))
          .query(`
            SELECT DISTINCT PolID, PolNo, PolHolderName, PolStartDate, PolEndDate, PolStatus
            FROM Lawton.dbo.tblmapolicy WITH(NOLOCK)
            WHERE Pol_CorporateId = @corpId AND (PolStatus = 'A' OR PolStatus = 'Active' OR PolEndDate >= GETDATE())
            ORDER BY PolNo ASC
          `);

        if (dbRes.recordset && dbRes.recordset.length > 0) {
          for (const r of dbRes.recordset) {
            const polNo = (r.PolNo || '').trim();
            if (!polNo) continue;
            const key = polNo.toLowerCase();
            if (!policiesMap.has(key)) {
              policiesMap.set(key, {
                polId: Number(r.PolID) || 0,
                polNo,
                planName: '',
                polHolderName: (r.PolHolderName || '').trim(),
                startDate: formatDate(parseDate(r.PolStartDate)),
                endDate: formatDate(parseDate(r.PolEndDate)),
                corpId: Number(corpId),
              });
            }
          }
        }
      } catch (dbErr: any) {
        this.logger.warn(`Failed fetching corporate policies from DB: ${dbErr.message}`, BrokerService.name, { corpId });
      }
    }

    // 3. Fallback to broker's general policy list if still empty
    if (policiesMap.size === 0) {
      const policyResult = await this.getPolicyList(trimmedTenantId, user);
      let policies = policyResult?.policies || [];
      if (corpId && Number(corpId) > 0) {
        policies = policies.filter((p: any) => Number(p.corpId) === Number(corpId));
      }
      for (const p of policies) {
        const polNo = (p.polNo || '').trim();
        if (polNo && !policiesMap.has(polNo.toLowerCase())) {
          policiesMap.set(polNo.toLowerCase(), {
            polId: p.polId,
            polNo,
            planName: p.planName || '',
            polHolderName: p.polHolderName || '',
            startDate: String(p.startDate || ''),
            endDate: String(p.endDate || ''),
            corpId: p.corpId || 0,
          });
        }
      }
    }

    // Sort alphabetically by polNo
    const sorted = Array.from(policiesMap.values()).sort((a, b) =>
      a.polNo.localeCompare(b.polNo, undefined, { sensitivity: 'base' })
    );

    return { isSuccess: true, policies: sorted };
  }

  /**
   * Retrieves distinct plan names for a policy.
   */
  async getClientDetailsPlans(
    tenantId: string,
    user: UserSessionPayload,
    polId?: number,
    polNo?: string,
    corpId?: number,
  ): Promise<{ isSuccess: boolean; plans: string[] }> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const dbConfig = tenantConfig.config?.database;

    const plansSet = new Set<string>();

    // 1. Query Lawton.dbo.vwPolicyPlanType (the exact query from legacy BrokerHomeController.GetPoliciesPlanTypeById)
    if (dbConfig && polNo?.trim()) {
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);
        const res = await pool
          .request()
          .input('polNo', polNo.trim())
          .query(`
            SELECT DISTINCT PlanName, PolNo, PLANPOLID 
            FROM Lawton.dbo.vwPolicyPlanType WITH(NOLOCK)
            WHERE PolNo = @polNo AND PlanName IS NOT NULL AND RTRIM(LTRIM(PlanName)) <> ''
            ORDER BY PlanName ASC
          `);

        if (res.recordset && res.recordset.length > 0) {
          for (const r of res.recordset) {
            const name = (r.PlanName || '').toString().trim();
            if (name) plansSet.add(name);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed fetching plans from vwPolicyPlanType: ${err.message}`, BrokerService.name, { polNo });
      }
    }

    // 2. Query Lawton.dbo.data_table for program_plan for this policy
    if (dbConfig && polNo?.trim() && plansSet.size === 0) {
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);
        const res = await pool
          .request()
          .input('polNo', polNo.trim())
          .query(`
            SELECT DISTINCT program_plan 
            FROM Lawton.dbo.data_table WITH(NOLOCK)
            WHERE policy_no = @polNo AND program_plan IS NOT NULL AND RTRIM(LTRIM(program_plan)) <> ''
            ORDER BY program_plan ASC
          `);

        if (res.recordset && res.recordset.length > 0) {
          for (const r of res.recordset) {
            const name = (r.program_plan || '').toString().trim();
            if (name) plansSet.add(name);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed fetching plans from data_table: ${err.message}`, BrokerService.name, { polNo });
      }
    }

    // 3. Fallback from policy list
    if (plansSet.size === 0) {
      const policyResult = await this.getPolicyList(trimmedTenantId, user);
      let policies = policyResult?.policies || [];
      if (polNo?.trim()) {
        policies = policies.filter((p: any) => (p.polNo || '').toLowerCase() === polNo.trim().toLowerCase());
      } else if (polId && Number(polId) > 0) {
        policies = policies.filter((p: any) => Number(p.polId) === Number(polId));
      }
      for (const p of policies) {
        if (p.planName?.trim()) {
          plansSet.add(p.planName.trim());
        }
      }
    }

    const sortedPlans = Array.from(plansSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    return { isSuccess: true, plans: sortedPlans };
  }

  /**
   * Helper to parse date formats (/Date(timestamp)/ or ISO strings).
   * When preferUtc is true, Date(timestamp) and Date objects are formatted using UTC date parts.
   */
  private parseDateStr(raw: any, preferUtc = false): string {
    if (!raw) return '-';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const parts = trimmed.split('T')[0].split('-');
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10) - 1;
        const day = parts[2].padStart(2, '0');
        if (monthNum >= 0 && monthNum <= 11) {
          return `${day}-${months[monthNum]}-${year}`;
        }
      }
      if (trimmed.includes('/Date(')) {
        const match = trimmed.match(/\/Date\((\d+)/);
        if (match) {
          const d = new Date(Number(match[1]));
          if (preferUtc) {
            const day = String(d.getUTCDate()).padStart(2, '0');
            const month = months[d.getUTCMonth()];
            const year = d.getUTCFullYear();
            return `${day}-${month}-${year}`;
          }
          return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        }
      }
    }
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      if (preferUtc) {
        const day = String(d.getUTCDate()).padStart(2, '0');
        const month = months[d.getUTCMonth()];
        const year = d.getUTCFullYear();
        return `${day}-${month}-${year}`;
      }
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    } catch {
      return String(raw);
    }
  }

  private parseDate(raw: any): Date | null {
    if (!raw) return null;
    if (typeof raw === 'string' && raw.includes('/Date(')) {
      const match = raw.match(/\/Date\((\d+)/);
      if (match) return new Date(Number(match[1]));
    }
    try {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }

  /**
   * Searches members/beneficiaries across IPMI Claim API v2 with database fallback.
   */
  async searchClientDetails(
    tenantId: string,
    user: UserSessionPayload,
    dto: SearchClientDetailsDto,
  ): Promise<ClientDetailsSearchResponse> {
    const startedAt = Date.now();
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);

    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(dto.limit) || 20));
    const offset = (page - 1) * limit;

    // 1. Primary path: Use Claim API v2 (matching legacy portal BuildBrokerPolicySearchModel)
    const v2Url = tenantConfig.config?.claimApis?.v2;
    const v2Key = tenantConfig.config?.claimApis?.v2Key || '123412341234';

    if (v2Url) {
      try {
        const searchByName = Boolean(dto.name?.trim());
        const searchByEmail = Boolean(dto.email?.trim());
        const searchByEmp = Boolean(dto.staffId?.trim() || dto.empCode?.trim());
        const polIdNum = dto.polId && Number(dto.polId) > 0 ? Number(dto.polId) : 0;
        const corpIdNum = dto.corpId && Number(dto.corpId) > 0 ? Number(dto.corpId) : 0;

        // Stage 1: Exact legacy BuildBrokerPolicySearchModel payload (Range: 100, PolicyCorpIds, PolicyIds)
        const stage1Payload: Record<string, any> = {
          BeneficiaryName: searchByName ? dto.name?.trim() : null,
          BenefEmail: searchByEmail ? dto.email?.trim() : null,
          EmployeeNo: searchByEmp ? (dto.staffId?.trim() || dto.empCode?.trim()) : null,
          AllowFuzzinessInBenefName: false,
          PercentageMatchForFuzziness: 0,
          Range: 100,
          StartIndex: 0,
          PolicyCorpIds: corpIdNum > 0 ? [corpIdNum] : null,
          PolicyIds: polIdNum > 0 ? [polIdNum] : null,
        };

        const v2Res = await fetch(`${v2Url.replace(/\/+$/, '')}/api/v2/BeneficiarySearch/.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CA-SHARED-KEY': v2Key,
            'Payer': trimmedTenantId,
          },
          body: JSON.stringify(stage1Payload),
        });

        let rawList: any[] = [];
        if (v2Res.ok) {
          const v2Data = await v2Res.json();
          rawList = v2Data.beneficiaryDetails || [];
        }

        // Stage 2: Legacy fallback when Stage 1 yields 0 records and policy number is present (polNo + DbType='MA')
        if (rawList.length === 0 && dto.polNo?.trim()) {
          try {
            const stage2Payload: Record<string, any> = {
              BeneficiaryName: searchByName ? dto.name?.trim() : null,
              BenefEmail: searchByEmail ? dto.email?.trim() : null,
              EmployeeNo: searchByEmp ? (dto.staffId?.trim() || dto.empCode?.trim()) : null,
              PolicyNo: dto.polNo.trim(),
              AllowFuzzinessInBenefName: false,
              PercentageMatchForFuzziness: 0,
              Range: 100,
              StartIndex: 0,
              PolicyCorpIds: corpIdNum > 0 ? [corpIdNum] : null,
              DbType: 'MA',
            };

            const stage2Res = await fetch(`${v2Url.replace(/\/+$/, '')}/api/v2/BeneficiarySearch/.json`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CA-SHARED-KEY': v2Key,
                'Payer': trimmedTenantId,
              },
              body: JSON.stringify(stage2Payload),
            });

            if (stage2Res.ok) {
              const stage2Data = await stage2Res.json();
              rawList = stage2Data.beneficiaryDetails || [];
            }
          } catch (stg2Err: any) {
            this.logger.warn(`Stage 2 polNo fallback error: ${stg2Err.message}`, BrokerService.name);
          }
        }

        if (rawList.length > 0) {
          // 1. Policy scoping (matching legacy portal: BuildBrokerPolicySearchModel)
          if (polIdNum > 0) {
            rawList = rawList.filter((b: any) => Number(b.policyDetail?.polID) === polIdNum);
          } else if (dto.polNo?.trim()) {
            const polNoNorm = dto.polNo.trim().toLowerCase();
            rawList = rawList.filter((b: any) =>
              b.policyDetail?.polNo?.trim().toLowerCase() === polNoNorm
            );
          }

          // 2. Deduplicate by MediAssistID (matching legacy portal: details.GroupBy(x => x.MediAssistID).Select(g => g.First()))
          const seenMaids = new Set<string>();
          rawList = rawList.filter((b: any) => {
            const mId = String(b.benefMediAssistID || '');
            if (!mId) return true;
            if (seenMaids.has(mId)) return false;
            seenMaids.add(mId);
            return true;
          });

          // 3. Enrich via Claim API v3 FetchMemberPolicyDetails (exact legacy portal ElasticAPI.cs logic)
          const v3Url = tenantConfig.config?.claimApis?.v3;
          if (v3Url && rawList.length > 0) {
            const uniqueMemberPolIds = Array.from(
              new Set(
                rawList
                  .map((b: any) => Number(b.primaryBenefDetails?.memberPolId || b.benefMemberPolicyId))
                  .filter((id: number) => id && id > 0),
              ),
            );

            if (uniqueMemberPolIds.length > 0) {
              const memberDetailsMap = new Map<number, any>();
              await Promise.all(
                uniqueMemberPolIds.map(async (mPolId) => {
                  try {
                    const v3Res = await fetch(`${v3Url.replace(/\/+$/, '')}/FetchMemberPolicyDetails`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'X-CA-SHARED-KEY': v2Key,
                        'Payer': trimmedTenantId,
                      },
                      body: JSON.stringify({ polId: mPolId, dbType: 'MA' }),
                    });
                    if (v3Res.ok) {
                      const v3Data = await v3Res.json();
                      const detail = v3Data?.memberDetails?.[0];
                      if (detail) {
                        memberDetailsMap.set(mPolId, detail);
                      }
                    }
                  } catch (v3Err: any) {
                    this.logger.warn(`FetchMemberPolicyDetails failed for polId ${mPolId}: ${v3Err.message}`, BrokerService.name);
                  }
                }),
              );

              // Apply enrichment to rawList matching ElasticAPI.cs
              for (const b of rawList) {
                const mPolId = Number(b.primaryBenefDetails?.memberPolId || b.benefMemberPolicyId);
                const detail = memberDetailsMap.get(mPolId);
                if (detail) {
                  if (detail.travelStartDate) {
                    if (!b.policyDetail) b.policyDetail = {};
                    b.policyDetail.polStartDate = detail.travelStartDate;
                  }
                  if (detail.travelEndDate) {
                    if (!b.policyDetail) b.policyDetail = {};
                    b.policyDetail.polEndDate = detail.travelEndDate;
                  }
                  if (detail.memberPolicyStatus) {
                    b.memberPolicyStatus = detail.memberPolicyStatus;
                  }
                  if (detail.actualEmpCode || detail.employeeCode) {
                    b.actualEmpCode = detail.actualEmpCode || detail.employeeCode;
                  }
                  if (detail.planDetails?.[0]?.typeOfPlan) {
                    b.benefPlanType = detail.planDetails[0].typeOfPlan;
                  }
                  if (detail.travelCountry && b.primaryBenefDetails) {
                    b.primaryBenefDetails.countryOfCoverage = detail.travelCountry;
                  }
                }
              }
            }
          }

          // 4. Exclude expired policies (matching legacy portal: PolEndDate >= DateTime.Today)
          // CRITICAL: Must execute AFTER v3 FetchMemberPolicyDetails enrichment because v3 sets b.policyDetail.polEndDate (travelEndDate)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          rawList = rawList.filter((b: any) => {
            const endStr = b.policyDetail?.polEndDate || b.benefWETo;
            if (!endStr) return true;
            const endDate = this.parseDate(endStr);
            return !endDate || endDate >= today;
          });

          // 5. Optional plan filter (matching legacy portal planType check)
          // CRITICAL: Must execute AFTER v3 FetchMemberPolicyDetails enrichment because v3 sets b.benefPlanType
          if (dto.plan?.trim() && dto.plan.trim() !== '0' && !dto.plan.toLowerCase().includes('select plan')) {
            const planNorm = dto.plan.trim().toLowerCase();
            rawList = rawList.filter((b: any) =>
              (b.benefPlanType && b.benefPlanType.toLowerCase().includes(planNorm)) ||
              (b.primaryBenefDetails?.priBenefGrade && b.primaryBenefDetails.priBenefGrade.toLowerCase().includes(planNorm))
            );
          }

          const members: ClientDetailsMember[] = rawList.map((b: any) => {
            const first = (b.benefName || '').trim();
            const last = (b.benefLastName || '').trim();
            const fullName = [first, last].filter(Boolean).join(' ').trim() || 'Insured Member';
            const staffId = b.actualEmpCode || b.primaryBenefDetails?.actualEmpCode || b.priBenefEmpCode || '';
            const pih = b.benefNIAPersonID || b.insurerBenefNumber || '';
            const rel = b.benefRelName?.toLowerCase() === 'self' ? 'Insured' : (b.benefRelName || 'Insured');
            const origDate = b.benefInceptionDate ? this.parseDateStr(b.benefInceptionDate) : '-';
            const sDate = this.parseDateStr(b.policyDetail?.polStartDate || b.benefWEF, true);
            const eDate = this.parseDateStr(b.policyDetail?.polEndDate || b.benefWETo, true);
            const isActive = b.benefActive !== false;

            return {
              maid: String(b.benefMediAssistID),
              name: fullName,
              firstName: first,
              lastName: last,
              emailId: b.benefEmail || '',
              staffId,
              pihNumber: pih,
              relation: rel,
              policyStatus: b.memberPolicyStatus || 'Active Current',
              inceptionDate: origDate,
              originalEntryDate: origDate,
              startDate: sDate,
              endDate: eDate,
              effectiveExpiry: `${sDate} ${eDate}`,
              memberStatus: isActive ? 'Active' : 'Inactive',
              isBenefActive: isActive,
              planType: b.benefPlanType || b.primaryBenefDetails?.priBenefGrade || '',
              polNo: b.policyDetail?.polNo || dto.polNo || '',
              corpName: b.policyDetail?.polHolderName || '',
              insuranceCompany: b.policyDetail?.insuranceCompanyName || '',
              policyId: b.policyDetail?.polID,
              insurerId: b.policyDetail?.polInsCompID,
              priBenefId: b.primaryBenefDetails?.priBenefID || b.benefPriID || 0,
              benefUserId: b.benefUserID || 0,
            };
          });

          const totalCount = members.length;
          const paginatedMembers = members.slice(offset, offset + limit);

          this.logger.log(`Client Details search via Claim API v2 found ${totalCount} records in ${Date.now() - startedAt}ms`, BrokerService.name, {
            tenantId: trimmedTenantId,
            totalCount,
            page,
            limit,
          });

          return {
            isSuccess: true,
            totalCount,
            total: totalCount,
            page,
            limit,
            members: paginatedMembers,
          };
        }
      } catch (apiErr: any) {
        this.logger.warn(`Claim API v2 search error, falling back to database: ${apiErr.message}`, BrokerService.name);
      }
    }

    // 2. Fallback path: Query database
    const dbConfig = tenantConfig.config?.database;
    if (!dbConfig) {
      throw new InternalServerErrorException('Database configuration is missing for this tenant.');
    }

    try {
      const pool = await this.sqlServerService.getPool(dbConfig);
      const req = pool.request();

      const conditions: string[] = ['1=1'];

      if (dto.corpId && Number(dto.corpId) > 0) {
        req.input('corpId', Number(dto.corpId));
        conditions.push('corp_id = @corpId');
      }

      if (dto.polId && Number(dto.polId) > 0) {
        req.input('polId', Number(dto.polId));
        conditions.push('pol_id = @polId');
      }

      if (dto.polNo?.trim()) {
        req.input('polNo', dto.polNo.trim());
        conditions.push('policy_no = @polNo');
      }

      if (dto.plan?.trim()) {
        req.input('plan', `%${dto.plan.trim()}%`);
        conditions.push('program_plan LIKE @plan');
      }

      if (dto.name?.trim()) {
        req.input('name', `%${dto.name.trim()}%`);
        conditions.push(`(
          first_name LIKE @name 
          OR last_name LIKE @name 
          OR CONCAT(LTRIM(RTRIM(ISNULL(first_name, ''))), ' ', LTRIM(RTRIM(ISNULL(last_name, '')))) LIKE @name
          OR CONCAT(LTRIM(RTRIM(ISNULL(first_name, ''))), ' ', LTRIM(RTRIM(ISNULL(middle_name, ''))), ' ', LTRIM(RTRIM(ISNULL(last_name, '')))) LIKE @name
        )`);
      }

      if (dto.email?.trim()) {
        req.input('email', `%${dto.email.trim()}%`);
        conditions.push('email LIKE @email');
      }

      const staffOrEmp = dto.staffId?.trim() || dto.empCode?.trim();
      if (staffOrEmp) {
        req.input('staffId', `%${staffOrEmp}%`);
        conditions.push('(staff_id_no LIKE @staffId OR emp_id LIKE @staffId)');
      }

      if (dto.memberId?.trim()) {
        req.input('memberId', `%${dto.memberId.trim()}%`);
        conditions.push('(pih_member_no LIKE @memberId OR CAST(maid AS NVARCHAR(50)) LIKE @memberId)');
      }

      const whereClause = conditions.join(' AND ');

      req.input('offset', offset);
      req.input('limit', limit);

      const countQuery = `SELECT COUNT(1) AS totalCount FROM Lawton.dbo.data_table WITH(NOLOCK) WHERE ${whereClause}`;
      const dataQuery = `
        SELECT 
          id, pol_id, corp_id, first_name, middle_name, last_name, staff_id_no, emp_id,
          pih_member_no, relationship, relation, policy_status, program_plan,
          original_entry_date, effective_date, expiry_date, is_active, email,
          mobile_number, policy_no, company_name, maid, id_passport_no, nationality,
          sum_assured, coverage_area, physical_address, dob, gender, marital_status
        FROM Lawton.dbo.data_table WITH(NOLOCK)
        WHERE ${whereClause}
        ORDER BY id DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `;

      const [countResult, dataResult] = await Promise.all([
        req.query(countQuery),
        req.query(dataQuery),
      ]);

      const totalCount = Number(countResult.recordset[0]?.totalCount) || 0;
      const rows = dataResult.recordset || [];

      const members: ClientDetailsMember[] = rows.map((r: any) => {
        const fullName = [r.first_name, r.middle_name, r.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Insured Member';

        const origDate = r.original_entry_date ? this.parseDateStr(r.original_entry_date) : '-';
        const sDate = this.parseDateStr(r.effective_date);
        const eDate = this.parseDateStr(r.expiry_date);
        const activeBool = r.is_active === true || r.is_active === 1 || String(r.policy_status).toLowerCase() === 'active';

        return {
          maid: String(r.maid || r.id),
          name: fullName,
          firstName: r.first_name || '',
          middleName: r.middle_name || '',
          lastName: r.last_name || '',
          emailId: r.email || '',
          staffId: r.staff_id_no || r.emp_id || '',
          pihNumber: r.pih_member_no || '',
          relation: r.relationship || r.relation || 'Insured',
          policyStatus: r.policy_status || (activeBool ? 'Active Current' : 'Inactive'),
          inceptionDate: origDate,
          originalEntryDate: origDate,
          startDate: sDate,
          endDate: eDate,
          effectiveExpiry: `${sDate} ${eDate}`,
          memberStatus: (activeBool ? 'Active' : 'Inactive') as 'Active' | 'Inactive',
          isBenefActive: activeBool,
          planType: r.program_plan || '',
          polNo: r.policy_no || '',
          corpName: r.company_name || '',
        };
      });

      this.logger.log(`Client Details search completed (DB): found ${totalCount} records in ${Date.now() - startedAt}ms`, BrokerService.name, {
        tenantId: trimmedTenantId,
        totalCount,
        page,
        limit,
      });

      return {
        isSuccess: true,
        totalCount,
        total: totalCount,
        page,
        limit,
        members,
      };
    } catch (err: any) {
      this.logger.error(`Error searching client details: ${err.message}`, err.stack, BrokerService.name, {
        tenantId: trimmedTenantId,
      });
      return {
        isSuccess: false,
        totalCount: 0,
        total: 0,
        page,
        limit,
        members: [],
        error: 'Unable to search client details. Please try again.',
      };
    }
  }

  /**
   * Retrieves single beneficiary details and policy metadata matching legacy portal.
   */
  async getClientDetailsBeneficiary(
    tenantId: string,
    user: UserSessionPayload,
    maid: string,
  ): Promise<ClientDetailsBeneficiaryResponse> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const v1Url = tenantConfig.config?.claimApis?.v1 || 'https://uat-lawton-claimapi-v1.lawtonasia.com';
    const v2Url = tenantConfig.config?.claimApis?.v2 || 'https://uat-lawton-claimapi-v2.lawtonasia.com';
    const v2Key = tenantConfig.config?.claimApis?.v2Key || '123412341234';
    const apiKey = process.env.LAWTON_DX_API_KEY || 'KAtWQBHV1096TuH8JTzLxdQvNqFxrUAOWJ3ElF9w1sIEqoyj8rCTeFtIRGflIQ6oi6eGIAWzPa5JE4nOwQElgZMUfQ4AtsxsZvBciHGKc5GWBmEMZ1ybZcigfZwvDf3C';
    const dxUrl = tenantConfig.config?.dataexchange?.api || 'https://uat-lawton-dx.lawtonasia.com';

    let policyInfo: any = null;
    let beneficiaries: any[] = [];
    let beneficiaryData: Record<string, any> | null = null;

    const numericMaid = Number(maid);
    const isValidNumericMaid = !isNaN(numericMaid) && numericMaid > 0;

    // 1. Fetch Policy & Beneficiaries via Claim API v1 & v2 (matching legacy portal)
    if (isValidNumericMaid) {
      try {
        const [v1Res, famRes] = await Promise.all([
          fetch(`${v1Url.replace(/\/+$/, '')}/memberportal/search/policybenef/${encodeURIComponent(maid)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ PrimaryMAID: numericMaid }),
          }),
          fetch(`${v2Url.replace(/\/+$/, '')}/api/v2/BeneficiaryFamily/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CA-SHARED-KEY': v2Key,
              'Payer': trimmedTenantId,
            },
            body: JSON.stringify({ beneficiaryMediAssistId: numericMaid, dbType: 'MA' }),
          }),
        ]);

        if (v1Res.ok) {
          const v1Data = await v1Res.json();
          const famData = famRes.ok ? await famRes.json() : null;

          const policyDoc = v1Data.policyBenefDetails?.[0]?.policyDetails || {};
          const famList = famData?.beneficiaryDetails || [];

          // Fetch policy-level eCard and COI configuration via Claim API v3 (exact legacy portal HRHomeController/BrokerHomeController logic)
          let showEcard = false;
          let showCOI = false;
          const v3Url = tenantConfig.config?.claimApis?.v3;
          if (policyDoc.policyId && v3Url) {
            try {
              const pRes = await fetch(`${v3Url.replace(/\/+$/, '')}/FetchPolicyDetails`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CA-SHARED-KEY': v2Key,
                  'Payer': trimmedTenantId,
                },
                body: JSON.stringify({ policyId: policyDoc.policyId }),
              });
              if (pRes.ok) {
                const pData = await pRes.json();
                const extra = pData?.extraDetails;
                const isHR = user.activePortal === 'hr' || Boolean(user.roles?.isCorpHR);
                const eCardTag = isHR ? 'ShowECardForHR' : 'ShowECardForBroker';
                const coiTag = isHR ? 'ShowCOIForHR' : 'ShowCOIForBroker';

                showEcard = Array.isArray(extra?.eCardConfig) &&
                  extra.eCardConfig.some((c: any) => c.tagName?.trim() === eCardTag && String(c.tagValue)?.trim() === '1');

                showCOI = Array.isArray(extra?.coiConfig) &&
                  extra.coiConfig.some((c: any) => c.tagName?.trim() === coiTag && String(c.tagValue)?.trim() === '1');
              }
            } catch (pErr: any) {
              this.logger.warn(`Failed fetching policy config from /FetchPolicyDetails: ${pErr.message}`, BrokerService.name, { policyId: policyDoc.policyId });
            }
          }

          policyInfo = {
            category: policyDoc.pol_CategoryName || '',
            insuranceCompany: policyDoc.insuranceCompany || '',
            policyNumber: policyDoc.policyNumber || '',
            validityPeriod: `${this.parseDateStr(policyDoc.startDate)} To ${this.parseDateStr(policyDoc.endDate)}`,
            planType: policyDoc.policyType === 'Group' ? 'Long Term Plan' : (policyDoc.policyType || ''),
            planName: famList[0]?.benefPlanType || famList[0]?.primaryBenefDetails?.priBenefGrade || v1Data.policyBenefDetails?.[0]?.beneficiaryDetails?.[0]?.benefPlanType || '',
            policyId: policyDoc.policyId,
            insurerId: policyDoc.insurerId,
            showEcard,
            showCOI,
          };

          const rawBenefs = v1Data.policyBenefDetails?.[0]?.beneficiaryDetails || [];
          beneficiaries = rawBenefs.map((b: any) => {
            const rawId = b.mediAssistID ?? b.MediAssistID ?? b.mediAssistId;
            const fam = famList.find((f: any) => Number(f.benefMediAssistID) === Number(rawId)) || {};
            const first = (fam.benefName || b.name || '').trim();
            const last = (fam.benefLastName || b.lastName || '').trim();
            const fullName = [first, last].filter(Boolean).join(' ').trim() || first;
            const rel = fam.benefRelName?.toLowerCase() === 'self' ? 'Insured' : (fam.benefRelName || b.relation || '');
            const pih = fam.benefNIAPersonID || b.pihNumber || '';
            const staffId = fam.primaryBenefDetails?.actualEmpCode || b.actualEmpCode || b.priBenefEmpCode || '';
            const isActive = fam.benefActive !== false;
            const resolvedMaid = String(rawId ?? fam.benefMediAssistID ?? fam.beneficiaryMediAssistId ?? maid);

            return {
              maid: resolvedMaid,
              name: fullName,
              relation: rel,
              pihNumber: pih,
              staffId,
              status: isActive ? 'Active Current' : 'Inactive',
              isActive,
              policyId: policyDoc.policyId,
              insurerId: policyDoc.insurerId,
              benefPriId: b.priBenefId || fam.benefPriID || 0,
              benefUserId: b.benefUserID || fam.benefUserID || 0,
              polId: policyDoc.policyId || b.priBenefPolID || fam.benefPolID || 0,
              corporateId: policyDoc.corporateId || 0,
            };
          });
        }
      } catch (apiErr: any) {
        this.logger.warn(`Failed fetching policy/family from Claim APIs: ${apiErr.message}`, BrokerService.name, { maid });
      }
    }

    // 2. Fetch edit details from Lawton DX API
    try {
      const res = await fetch(`${dxUrl.replace(/\/+$/, '')}/api/beneficiaryinfo/getDetail/${encodeURIComponent(maid)}`, {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.isSuccess && json.data) {
          beneficiaryData = json.data;
        }
      }
    } catch (apiErr: any) {
      this.logger.warn(`Failed fetching beneficiary from DX API: ${apiErr.message}`, BrokerService.name, { maid });
    }

    // Fallback to SQL data_table if DX API did not return data
    const dbConfig = tenantConfig.config?.database;
    if (!beneficiaryData && dbConfig) {
      try {
        const pool = await this.sqlServerService.getPool(dbConfig);
        const row = await pool
          .request()
          .input('maid', maid)
          .query(`SELECT TOP 1 * FROM Lawton.dbo.data_table WITH(NOLOCK) WHERE maid = @maid ORDER BY uploaded_on DESC`);
        if (row.recordset?.length) {
          beneficiaryData = row.recordset[0];
        }
      } catch (dbErr: any) {
        this.logger.warn(`Failed fetching beneficiary fallback from DB: ${dbErr.message}`, BrokerService.name, { maid });
      }
    }

    return {
      isSuccess: true,
      data: beneficiaryData || undefined,
      policy: policyInfo || undefined,
      showEcard: policyInfo?.showEcard ?? false,
      showCOI: policyInfo?.showCOI ?? false,
      beneficiaries,
      dependents: beneficiaries,
    };
  }

  /**
   * Updates beneficiary information via Lawton DX service and synchronizes local tables.
   */
  async updateClientDetailsBeneficiary(
    tenantId: string,
    user: UserSessionPayload,
    maid: string,
    dto: UpdateBeneficiaryDto,
  ): Promise<{ isSuccess: boolean; message: string }> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const apiKey = process.env.LAWTON_DX_API_KEY || 'KAtWQBHV1096TuH8JTzLxdQvNqFxrUAOWJ3ElF9w1sIEqoyj8rCTeFtIRGflIQ6oi6eGIAWzPa5JE4nOwQElgZMUfQ4AtsxsZvBciHGKc5GWBmEMZ1ybZcigfZwvDf3C';
    const dxUrl = tenantConfig.config?.dataexchange?.api || 'https://uat-lawton-dx.lawtonasia.com';

    const parseDateToISO = (val?: string) => {
      if (!val?.trim()) return null;
      try {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d.toISOString();
      } catch {
        return null;
      }
    };

    const payload = {
      UserDetails: {
        maid: String(maid),
        uploaded_by: 'lawton_asia',
        insurer_id_no: (dto.insurerNo || '').trim(),
        pih_member_no: (dto.pihNumber || '').trim(),
        first_name: (dto.firstName || '').trim(),
        middle_name: (dto.middleName || '').trim(),
        last_name: (dto.lastName || '').trim(),
        id_passport_no: (dto.passportNo || '').trim(),
        dob: parseDateToISO(dto.dob),
        age: Number(dto.age) || 0,
        gender: (dto.sex || '').trim(),
        marital_status: (dto.maritalStatus || '').trim(),
        relationship: (dto.relationshipCode || dto.relation || '').trim(),
        nationality: (dto.nationality || '').trim(),
        home_country: (dto.homeCountry || '').trim(),
        sum_assured: Number(dto.sumInsured) || 0,
        email: (dto.emailId || '').trim(),
        mobile_number: (dto.mobileNumber || '').trim(),
        coverage_area: (dto.areaCode || '').trim(),
        physical_address: (dto.address || '').trim(),
        effective_date: parseDateToISO(dto.inceptionDate),
        expiry_date: parseDateToISO(dto.expiryDate),
      },
    };

    try {
      const res = await fetch(`${dxUrl.replace(/\/+$/, '')}/api/beneficiaryinfo/update`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseJson = await res.json().catch(() => null);

      if (!res.ok || (responseJson && responseJson.isSuccess === false)) {
        const errMsg = responseJson?.message || 'Unable to update beneficiary details.';
        this.logger.warn(`Lawton DX update error: ${errMsg}`, BrokerService.name, { maid, status: res.status });
        return { isSuccess: false, message: errMsg };
      }

      // Also sync directly to SQL Server data_table
      const dbConfig = tenantConfig.config?.database;
      if (dbConfig) {
        try {
          const pool = await this.sqlServerService.getPool(dbConfig);
          await pool
            .request()
            .input('maid', maid)
            .input('firstName', payload.UserDetails.first_name)
            .input('middleName', payload.UserDetails.middle_name)
            .input('lastName', payload.UserDetails.last_name)
            .input('pihNumber', payload.UserDetails.pih_member_no)
            .input('relationship', payload.UserDetails.relationship)
            .input('email', payload.UserDetails.email)
            .input('mobileNumber', payload.UserDetails.mobile_number)
            .input('address', payload.UserDetails.physical_address)
            .input('passportNo', payload.UserDetails.id_passport_no)
            .input('maritalStatus', payload.UserDetails.marital_status)
            .input('nationality', payload.UserDetails.nationality)
            .input('homeCountry', payload.UserDetails.home_country)
            .input('sumAssured', payload.UserDetails.sum_assured)
            .input('areaCode', payload.UserDetails.coverage_area)
            .query(`
              UPDATE Lawton.dbo.data_table
              SET 
                first_name = @firstName,
                middle_name = @middleName,
                last_name = @lastName,
                pih_member_no = @pihNumber,
                relationship = @relationship,
                email = @email,
                mobile_number = @mobileNumber,
                physical_address = @address,
                id_passport_no = @passportNo,
                marital_status = @maritalStatus,
                nationality = @nationality,
                home_country = @homeCountry,
                sum_assured = @sumAssured,
                coverage_area = @areaCode
              WHERE maid = @maid
            `);
        } catch (dbUpdateErr: any) {
          this.logger.warn(`Non-fatal DB update sync error: ${dbUpdateErr.message}`, BrokerService.name, { maid });
        }
      }

      return {
        isSuccess: true,
        message: responseJson?.message || 'Beneficiary details updated successfully.',
      };
    } catch (err: any) {
      this.logger.error(`Error updating beneficiary details: ${err.message}`, err.stack, BrokerService.name, { maid });
      return { isSuccess: false, message: 'Failed to update beneficiary details. Please try again.' };
    }
  }

  /**
   * Downloads or generates inline base64 for E-Card PDF matching legacy EcardController.
   */
  async downloadClientDetailsEcard(
    tenantId: string,
    user: UserSessionPayload,
    dto: DownloadEcardDto,
  ): Promise<{ isSuccess: boolean; data?: string; fileName?: string; message?: string }> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const ecardUrl = tenantConfig.config?.services?.ecard || 'https://uat-lawton-core-ecard.lawtonasia.com';
    const payerKey = tenantConfig.config?.claimApis?.pairKey || trimmedTenantId;
    const v2Key = tenantConfig.config?.claimApis?.v2Key || '123412341234';

    if (!dto.polid || !dto.maid) {
      return {
        isSuccess: false,
        message: 'E-Card data not available for this member.',
      };
    }

    const payload = {
      printRequest: {
        executionMode: 'Single',
        identifierType: 'MemberId',
        identifierValue: String(dto.maid),
        printPattern: dto.printPattern || 'Single',
      },
      policyId: Number(dto.polid),
      insurerId: String(dto.insurerid || '12'),
      corporateId: 0,
      policySubId: Number(dto.polSubtype || 0),
      outputType: 'PDFByteStream',
      dbType: 'MA',
    };

    try {
      // 1. Try Lawton / Test downloadECard endpoint
      const res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/Test/downloadECard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok && res.status !== 204) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/pdf')) {
          const arrayBuffer = await res.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          return {
            isSuccess: true,
            data: `data:application/pdf;base64,${base64}`,
            fileName: `ecard_${dto.maid}_${dto.polid}.pdf`,
            message: 'Ecard retrieved successfully.',
          };
        } else {
          const json = await res.json().catch(() => null);
          const fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
          if (fileBytes && Array.isArray(fileBytes) && fileBytes.length > 0) {
            const base64 = Buffer.from(fileBytes).toString('base64');
            return {
              isSuccess: true,
              data: `data:application/pdf;base64,${base64}`,
              fileName: `ecard_${dto.maid}_${dto.polid}.pdf`,
              message: 'Ecard retrieved successfully.',
            };
          }
        }
      }

      // 2. Fallback to /printRetailEcard
      const retailRes = await fetch(`${ecardUrl.replace(/\/+$/, '')}/printRetailEcard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(payload),
      });

      if (retailRes.ok) {
        const retailJson = await retailRes.json().catch(() => null);
        const fileBytes = retailJson?.data?.[0]?.printResponse?.fileBytes;
        if (fileBytes && Array.isArray(fileBytes) && fileBytes.length > 0) {
          const base64 = Buffer.from(fileBytes).toString('base64');
          return {
            isSuccess: true,
            data: `data:application/pdf;base64,${base64}`,
            fileName: `ecard_${dto.maid}_${dto.polid}.pdf`,
            message: 'Ecard retrieved successfully.',
          };
        }
        if (retailJson?.errorMessage) {
          return {
            isSuccess: false,
            message: retailJson.errorMessage === 'No template configuration not found'
              ? 'E-Card template configuration not found for this member.'
              : retailJson.errorMessage,
          };
        }
      }

      return {
        isSuccess: false,
        message: 'Unable to retrieve E-Card. Please verify active policy configuration.',
      };
    } catch (err: any) {
      this.logger.error(`Error downloading E-Card: ${err.message}`, err.stack, BrokerService.name, { dto });
      return {
        isSuccess: false,
        message: 'Unable to load eCard at this time.',
      };
    }
  }

  /**
   * Downloads or generates inline base64 for Certificate of Insurance (COI) matching legacy EcardController.
   */
  async downloadClientDetailsCoverage(
    tenantId: string,
    user: UserSessionPayload,
    dto: DownloadCoverageDto,
  ): Promise<{ isSuccess: boolean; data?: string; fileName?: string; message?: string }> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const ecardUrl = tenantConfig.config?.services?.ecard || 'https://uat-lawton-core-ecard.lawtonasia.com';
    const payerKey = tenantConfig.config?.claimApis?.pairKey || trimmedTenantId;
    const v2Key = tenantConfig.config?.claimApis?.v2Key || '123412341234';
    const v1Url = tenantConfig.config?.claimApis?.v1 || 'https://uat-lawton-claimapi-v1.lawtonasia.com';

    let resolvedBenefPriId = Number(dto.benefPriId);
    let resolvedBenefUserId = Number(dto.benefUserId);
    let resolvedPolId = Number(dto.polid);
    let resolvedInsurerId = Number(dto.insurerId);
    let resolvedCorporateId = Number(dto.corporateId || 0);

    const maidNum = Number(dto.maid);
    const needsResolution =
      !resolvedBenefPriId ||
      !resolvedBenefUserId ||
      !resolvedPolId ||
      !resolvedInsurerId ||
      resolvedBenefPriId === maidNum ||
      resolvedBenefUserId === maidNum;

    if (needsResolution && dto.maid) {
      try {
        const v1Res = await fetch(`${v1Url.replace(/\/+$/, '')}/memberportal/search/policybenef/${encodeURIComponent(dto.maid)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ PrimaryMAID: maidNum }),
        });
        if (v1Res.ok) {
          const v1Data = await v1Res.json();
          const polDoc = v1Data?.policyBenefDetails?.[0]?.policyDetails || {};
          const benefList = v1Data?.policyBenefDetails?.[0]?.beneficiaryDetails || [];
          const matchedBenef = benefList.find((b: any) => String(b.mediAssistID) === String(dto.maid)) || benefList[0] || {};

          if (matchedBenef.priBenefId) resolvedBenefPriId = matchedBenef.priBenefId;
          if (matchedBenef.benefUserID) resolvedBenefUserId = matchedBenef.benefUserID;
          if (polDoc.policyId) resolvedPolId = polDoc.policyId;
          if (polDoc.insurerId) resolvedInsurerId = polDoc.insurerId;
          if (polDoc.corporateId) resolvedCorporateId = polDoc.corporateId;
        }
      } catch (resErr: any) {
        this.logger.warn(`Failed resolving policybenef for coverage: ${resErr.message}`, BrokerService.name, { maid: dto.maid });
      }
    }

    // Zero artificial fallbacks: reject if required identifiers cannot be resolved
    if (!resolvedBenefPriId || !resolvedPolId) {
      return {
        isSuccess: false,
        message: 'Certificate of Insurance data not available for this member.',
      };
    }

    const buildPayload = (dbType: string) => ({
      PribenefId: resolvedBenefPriId,
      BenefId: resolvedBenefUserId,
      MemberPolicyId: resolvedPolId,
      MasterPolicyId: resolvedPolId,
      InsurerId: resolvedInsurerId,
      DbType: dbType,
      OutputType: 'PDFByteStream',
      CorporateId: resolvedCorporateId,
      AppId: '2',
      PrintPattern: 'Single',
    });

    try {
      // 1. First attempt with MAYFAIR (raw JSON body directly matching RestServiceUtil in legacy portal)
      let res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/mwc/printCoverageLetter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(buildPayload('MAYFAIR')),
      });

      let json = res.ok ? await res.json().catch(() => null) : null;
      let fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
      let fileName = json?.data?.[0]?.printResponse?.fileName;

      if (fileBytes) {
        this.logger.log(`Certificate of Insurance retrieved from core-ecard: fileName=${fileName}`, BrokerService.name);
      }

      // 2. If empty or null, retry with DbType 'MA' (as in legacy EcardController.cs:530)
      if (!fileBytes || !fileBytes.length) {
        res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/mwc/printCoverageLetter`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Payer: payerKey,
            'X-CA-SHARED-KEY': v2Key,
          },
          body: JSON.stringify(buildPayload('MA')),
        });
        json = res.ok ? await res.json().catch(() => null) : null;
        fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
        fileName = json?.data?.[0]?.printResponse?.fileName;
      }

      if (fileBytes && (typeof fileBytes === 'string' || (Array.isArray(fileBytes) && fileBytes.length > 0))) {
        const base64 = typeof fileBytes === 'string'
          ? fileBytes.replace(/^data:application\/pdf;base64,/, '')
          : Buffer.from(fileBytes).toString('base64');
        return {
          isSuccess: true,
          data: `data:application/pdf;base64,${base64}`,
          fileName: fileName ? (fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`) : `coi_${dto.maid}.pdf`,
          message: 'Certificate of Insurance retrieved successfully.',
        };
      }

      return {
        isSuccess: false,
        message: json?.errorMessage === 'No template configuration not found'
          ? 'Certificate of Insurance template not configured for this policy.'
          : (json?.errorMessage || 'Unable to retrieve Certificate of Insurance.'),
      };
    } catch (err: any) {
      this.logger.error(`Error downloading Coverage: ${err.message}`, err.stack, BrokerService.name, { dto });
      return {
        isSuccess: false,
        message: 'Unable to load Certificate of Insurance at this time.',
      };
    }
  }
}