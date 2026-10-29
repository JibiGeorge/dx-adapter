import { Injectable } from '@nestjs/common';
import { LoggingService } from '../../common/logging/logging.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { BrokerService } from '../broker/broker.service.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import {
  DownloadCoverageDto,
  DownloadEcardDto,
  SearchEcardDto,
} from './dto/ecard.dto.js';
import {
  EcardEntity,
  EcardMember,
  EcardPolicy,
  EcardSearchResponse,
} from './ecard.types.js';

@Injectable()
export class EcardService {
  constructor(
    private readonly logger: LoggingService,
    private readonly tenantService: TenantService,
    private readonly brokerService: BrokerService,
  ) {}

  /**
   * Retrieves corporate entities accessible to the user (Broker client list or HR corporate).
   */
  async getEntities(
    tenantId: string,
    user: UserSessionPayload,
  ): Promise<{ isSuccess: boolean; entities: EcardEntity[] }> {
    try {
      // 1. If Broker, use the broker's assigned clients
      if (user.roles?.isBroker || user.isAdminBroker) {
        const brokerRes = await this.brokerService.getClientDetailsEntities(
          tenantId,
          user,
        );
        return {
          isSuccess: true,
          entities: brokerRes.entities || [],
        };
      }

      // 2. If HR, return providerCorpId or list from policy search
      const hrCorpId = user.providerCorpId || 0;
      if (hrCorpId > 0) {
        return {
          isSuccess: true,
          entities: [
            {
              corpId: hrCorpId,
              corpName: user.loginName || `Corporate Entity ${hrCorpId}`,
            },
          ],
        };
      }

      // Fallback: query broker service entities
      const fallback = await this.brokerService.getClientDetailsEntities(
        tenantId,
        user,
      );
      return {
        isSuccess: true,
        entities: fallback.entities || [],
      };
    } catch (err: any) {
      this.logger.error(
        `Error getting ecard entities: ${err.message}`,
        err.stack,
        EcardService.name,
      );
      return { isSuccess: false, entities: [] };
    }
  }

  /**
   * Retrieves policies for the selected corporate entity.
   */
  async getPolicies(
    tenantId: string,
    user: UserSessionPayload,
    corpId?: number,
  ): Promise<{ isSuccess: boolean; policies: EcardPolicy[] }> {
    try {
      const effectiveCorpId = corpId || user.providerCorpId;
      const res = await this.brokerService.getClientDetailsPolicies(
        tenantId,
        user,
        effectiveCorpId,
      );

      const policies: EcardPolicy[] = (res.policies || []).map((p) => ({
        polId: p.polId,
        polNo: p.polNo,
        polHolderName: p.polHolderName,
        inceptionDate: p.startDate,
        expiryDate: p.endDate,
      }));

      return { isSuccess: true, policies };
    } catch (err: any) {
      this.logger.error(
        `Error getting ecard policies: ${err.message}`,
        err.stack,
        EcardService.name,
      );
      return { isSuccess: false, policies: [] };
    }
  }

  /**
   * Fetches policy configuration details (eCardConfig, coiConfig) from Claim API v3.
   */
  async fetchPolicyConfig(
    tenantId: string,
    policyId: number,
  ): Promise<{ eCardConfig?: any[]; coiConfig?: any[] } | null> {
    const trimmedTenantId = tenantId.trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const v3Url = tenantConfig.config?.claimApis?.v3;
    const payerKey = tenantConfig.config?.claimApis?.pairKey || trimmedTenantId;
    if (!v3Url) return null;

    try {
      const res = await fetch(`${v3Url.replace(/\/+$/, '')}/FetchPolicyDetails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
        },
        body: JSON.stringify({ policyId }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.extraDetails || null;
    } catch (err: any) {
      this.logger.warn(`FetchPolicyDetails failed for policyId ${policyId}: ${err.message}`, EcardService.name);
      return null;
    }
  }

  /**
   * Searches for members/beneficiaries across Claim API v2 with database fallback,
   * supporting both Employee Code (Mayfair HR) and Beneficiary Name (Lawton HR/Broker).
   */
  async search(
    tenantId: string,
    user: UserSessionPayload,
    dto: SearchEcardDto,
  ): Promise<EcardSearchResponse> {
    try {
      let resolvedPolId = dto.polId;
      if (!resolvedPolId && dto.polNo) {
        const policiesRes = await this.getPolicies(tenantId, user, dto.corpId);
        const matched = policiesRes.policies?.find(
          (p) => p.polNo?.trim().toLowerCase() === dto.polNo?.trim().toLowerCase(),
        );
        if (matched?.polId) {
          resolvedPolId = matched.polId;
        }
      }

      // Policy-level document access check (mirroring legacy BrokerHomeController.cs:1278 & HRHomeController.cs:1873)
      // If a policy does not have ShowECardForBroker / ShowCOIForBroker set to '1', legacy returns 'No details found'
      const effectivePolId = resolvedPolId || dto.polId;
      const trimmedTenantId = (tenantId || '').trim();
      const isLawton = trimmedTenantId.includes('Lawton') || trimmedTenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

      let isEcardAllowed = true;
      let isCoiAllowed = true;

      if (isLawton && effectivePolId && effectivePolId > 0) {
        const policyConfig = await this.fetchPolicyConfig(tenantId, effectivePolId);
        const docType = (dto.docType || 'all').toLowerCase();
        const isBroker = Boolean(user.roles?.isBroker || user.isAdminBroker);

        const ecardTag = isBroker ? 'ShowECardForBroker' : 'ShowECardForHR';
        const coiTag = isBroker ? 'ShowCOIForBroker' : 'ShowCOIForHR';

        const eCardConfigs = policyConfig?.eCardConfig || [];
        const coiConfigs = policyConfig?.coiConfig || [];

        isEcardAllowed = eCardConfigs.some(
          (c: any) => c.tagName?.trim() === ecardTag && c.tagValue?.trim() === '1',
        );
        isCoiAllowed = coiConfigs.some(
          (c: any) => c.tagName?.trim() === coiTag && c.tagValue?.trim() === '1',
        );

        if (docType === 'ecard' && !isEcardAllowed) {
          return {
            isSuccess: false,
            total: 0,
            members: [],
            message: 'No details found',
          };
        }
        if (docType === 'coi' && !isCoiAllowed) {
          return {
            isSuccess: false,
            total: 0,
            members: [],
            message: 'No details found',
          };
        }
        // Unified search: if neither E-Card nor COI is enabled for this policy, return 'No details found'
        if (docType === 'all' && !isEcardAllowed && !isCoiAllowed) {
          return {
            isSuccess: false,
            total: 0,
            members: [],
            message: 'No details found',
          };
        }
      }

      const searchRes = await this.brokerService.searchClientDetails(
        tenantId,
        user,
        {
          corpId: dto.corpId || user.providerCorpId,
          corpName: dto.corpName,
          polId: resolvedPolId,
          polNo: dto.polNo,
          name: dto.benefName,
          staffId: dto.empCode,
          empCode: dto.empCode,
          page: dto.page || 1,
          limit: dto.limit || 50,
        },
      );

      const rawMembers = searchRes.members || [];
      if (!rawMembers.length) {
        return {
          isSuccess: false,
          total: 0,
          members: [],
          message: 'No details found',
        };
      }

      // Pre-check document availability matching legacy EcardController (IsEcardDocumentAvailable & IsCoverageDocumentAvailable)
      const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
      const rawAppId = tenantConfig?.config?.auth?.appId;
      const appId = rawAppId !== undefined && rawAppId !== null ? String(rawAppId).trim() : '';
      const ecardUrl = tenantConfig.config?.services?.ecard || 'https://uat-lawton-core-ecard.lawtonasia.com';
      const payerKey = tenantConfig.config?.claimApis?.pairKey || trimmedTenantId;
      const v2Key = tenantConfig.config?.claimApis?.v2Key || '123412341234';
      const docType = (dto.docType || 'both').toLowerCase();
      const wantEcard = docType === 'ecard' || docType === 'both' || docType === 'all';
      const wantCoi = docType === 'coi' || docType === 'both' || docType === 'all';

      const members: EcardMember[] = await Promise.all(
        rawMembers.map(async (m: any) => {
          const rawName = (m.name || `${m.firstName || ''} ${m.middleName || ''} ${m.lastName || ''}`).trim();
          const cleanName = rawName.replace(/\s*undefined\s*/gi, ' ').trim();
          const rawRel = (m.relation || '').trim();
          const cleanRelation = rawRel.toLowerCase() === 'self' ? 'Insured' : rawRel;

          const memberPolId = Number(m.policyId || resolvedPolId || effectivePolId || 0);
          const insurerId = Number(m.insurerId || 0);
          const priBenefId = Number(m.priBenefId || 0);
          const benefUserId = Number(m.benefUserId || 0);
          const corpId = Number(dto.corpId || user.providerCorpId || 0);

          let hasEcard = false;
          let hasCoi = false;

          if (isLawton) {
            const [ecardAvailable, coiAvailable] = await Promise.all([
              wantEcard && isEcardAllowed && m.maid && memberPolId > 0 && insurerId > 0
                ? this.isEcardDocumentAvailable(
                    ecardUrl,
                    payerKey,
                    v2Key,
                    String(m.maid),
                    memberPolId,
                    insurerId,
                  )
                : Promise.resolve(false),
              wantCoi && isCoiAllowed && priBenefId > 0 && benefUserId > 0 && memberPolId > 0 && insurerId > 0 && Boolean(appId)
                ? this.isCoverageDocumentAvailable(
                    ecardUrl,
                    payerKey,
                    v2Key,
                    priBenefId,
                    benefUserId,
                    memberPolId,
                    insurerId,
                    corpId,
                    appId,
                  )
                : Promise.resolve(false),
            ]);
            hasEcard = ecardAvailable;
            hasCoi = coiAvailable;
          } else {
            hasEcard = Boolean(m.maid && memberPolId > 0);
            hasCoi = Boolean(priBenefId > 0 && benefUserId > 0 && memberPolId > 0);
          }

          const isDocumentAvailable =
            docType === 'ecard' ? hasEcard : docType === 'coi' ? hasCoi : (hasEcard || hasCoi);

          return {
            maid: String(m.maid),
            name: cleanName || m.name || '',
            firstName: m.firstName,
            lastName: m.lastName,
            emailId: m.emailId || m.benefEmail || '',
            staffId: m.staffId || m.actualEmpCode || '',
            pihNumber: m.pihNumber || m.benefNIAPersonID || m.insurerBenefNumber || '',
            relation: cleanRelation,
            policyStatus: m.policyStatus || '',
            memberStatus: m.memberStatus || '',
            polNo: m.polNo || dto.polNo || '',
            corpName: m.corpName || dto.corpName || '',
            policyId: memberPolId,
            insurerId,
            priBenefId,
            benefUserId,
            isDocumentAvailable,
            isEcardAvailable: hasEcard,
            isCoiAvailable: hasCoi,
          };
        }),
      );

      return {
        isSuccess: true,
        total: searchRes.total || members.length,
        members,
      };
    } catch (err: any) {
      this.logger.error(
        `Error searching ecard members: ${err.message}`,
        err.stack,
        EcardService.name,
      );
      return {
        isSuccess: false,
        total: 0,
        members: [],
        message: 'Unable to search e-card records at this time.',
      };
    }
  }

  /**
   * Validates whether raw file bytes represent a valid PDF.
   */
  private isValidPdfBytes(bytes: any): boolean {
    if (!bytes) return false;
    if (Buffer.isBuffer(bytes)) {
      return bytes.length > 4 && bytes.toString('utf8', 0, 4) === '%PDF';
    }
    if (Array.isArray(bytes)) {
      return (
        bytes.length > 4 &&
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46
      );
    }
    if (typeof bytes === 'string') {
      const clean = bytes.replace(/^data:application\/pdf;base64,/, '').trim();
      if (!clean) return false;
      try {
        const header = Buffer.from(clean.slice(0, 10), 'base64').toString('utf8');
        return header.startsWith('%PDF');
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Pre-checks whether E-Card PDF exists and contains valid PDF bytes.
   */
  private async isEcardDocumentAvailable(
    ecardUrl: string,
    payerKey: string,
    v2Key: string,
    maid: string,
    polId: number,
    insurerId: string | number,
  ): Promise<boolean> {
    try {
      if (!maid || !polId || !insurerId) return false;
      const payload = {
        printRequest: {
          executionMode: 'Single',
          identifierType: 'MemberId',
          identifierValue: String(maid),
          printPattern: 'Single',
        },
        isPasswordEnabled: false,
        printExpiredPolicy: false,
        policyId: Number(polId),
        insurerId: String(insurerId),
        dbType: 'MA',
        outputType: 'PDFByteStream',
      };

      // 1. Try Lawton /Test/downloadECard
      let res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/Test/downloadECard`, {
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
          const ab = await res.arrayBuffer();
          return this.isValidPdfBytes(Buffer.from(ab));
        }
        const json = await res.json().catch(() => null);
        const fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
        if (this.isValidPdfBytes(fileBytes)) return true;
      }

      // 2. Fallback to /printRetailEcard
      res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/printRetailEcard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        const fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
        if (this.isValidPdfBytes(fileBytes)) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Pre-checks whether Certificate of Insurance (COI) PDF exists and contains valid PDF bytes.
   */
  private async isCoverageDocumentAvailable(
    ecardUrl: string,
    payerKey: string,
    v2Key: string,
    priBenefId: number | undefined,
    benefUserId: number | undefined,
    polId: number,
    insurerId: string | number | undefined,
    corpId: number | undefined,
    appId: string,
  ): Promise<boolean> {
    try {
      const numPriBenefId = Number(priBenefId);
      const numBenefUserId = Number(benefUserId);
      const numPolId = Number(polId);
      const numInsurerId = Number(insurerId);
      if (!numPriBenefId || !numBenefUserId || !numPolId || !numInsurerId || !appId?.trim()) {
        return false;
      }
      const buildPayload = (dbType: string) => ({
        PribenefId: numPriBenefId,
        BenefId: numBenefUserId,
        MemberPolicyId: numPolId,
        MasterPolicyId: numPolId,
        InsurerId: numInsurerId,
        DbType: dbType,
        OutputType: 'PDFByteStream',
        CorporateId: Number(corpId || 0),
        AppId: appId.trim(),
        PrintPattern: 'Single',
      });

      // 1. Try with DbType MAYFAIR
      let res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/mwc/printCoverageLetter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(buildPayload('MAYFAIR')),
      });

      if (res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        const fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
        if (this.isValidPdfBytes(fileBytes)) return true;
      }

      // 2. Try with DbType MA
      res = await fetch(`${ecardUrl.replace(/\/+$/, '')}/mwc/printCoverageLetter`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Payer: payerKey,
          'X-CA-SHARED-KEY': v2Key,
        },
        body: JSON.stringify(buildPayload('MA')),
      });

      if (res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        const fileBytes = json?.data?.[0]?.printResponse?.fileBytes;
        if (this.isValidPdfBytes(fileBytes)) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Downloads or generates inline base64 for E-Card PDF via the external Core E-Card service.
   */
  async downloadEcard(
    tenantId: string,
    user: UserSessionPayload,
    dto: DownloadEcardDto,
  ) {
    return this.brokerService.downloadClientDetailsEcard(tenantId, user, {
      maid: String(dto.maid),
      polid: Number(dto.polid),
      insurerid: dto.insurerid,
      polSubtype: dto.polSubtype,
      printPattern: dto.printPattern,
    });
  }

  /**
   * Downloads or generates inline base64 for Certificate of Insurance (COI) PDF via the external Core E-Card service.
   */
  async downloadCoverage(
    tenantId: string,
    user: UserSessionPayload,
    dto: DownloadCoverageDto,
  ) {
    return this.brokerService.downloadClientDetailsCoverage(
      tenantId,
      user,
      {
        maid: String(dto.maid || ''),
        benefPriId: dto.benefPriId,
        benefUserId: dto.benefUserId,
        polid: dto.polid ? Number(dto.polid) : undefined,
        insurerId: dto.insurerId,
        corporateId: dto.corporateId ? Number(dto.corporateId) : undefined,
      },
    );
  }
}
