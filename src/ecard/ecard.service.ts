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

      const members: EcardMember[] = (searchRes.members || []).map((m: any) => {
        const isActive =
          m.memberStatus === 'Active' ||
          m.isBenefActive === true ||
          m.policyStatus?.toLowerCase()?.includes('active');

        return {
          maid: String(m.maid),
          name: m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim(),
          firstName: m.firstName,
          lastName: m.lastName,
          emailId: m.emailId || '',
          staffId: m.staffId || '',
          pihNumber: m.pihNumber || '',
          relation: m.relation || '',
          policyStatus: m.policyStatus || '',
          memberStatus: m.memberStatus || '',
          polNo: m.polNo || dto.polNo || '',
          corpName: m.corpName || dto.corpName || '',
          policyId: m.policyId || dto.polId,
          insurerId: m.insurerId,
          priBenefId: m.priBenefId,
          benefUserId: m.benefUserId,
          // Document availability flags evaluated against policy authorization
          isEcardAvailable: isEcardAllowed && Boolean(m.maid && (m.policyId || dto.polId)),
          isCoiAvailable: isCoiAllowed && Boolean(m.maid && (m.policyId || dto.polId)),
        };
      });

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
