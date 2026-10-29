import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '../../common/http/http.service.js';
import { LoggingService } from '../../common/logging/logging.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { BrokerService } from '../broker/broker.service.js';
import { ClaimApiService } from '../integrations/claim-api/claim-api.service.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import type {
  PolicyItem,
  BeneficiaryItem,
  PolicyDocumentItem,
  PolicyListResponse,
  PolicyBeneficiariesResponse,
  PolicyDocumentsResponse,
  PolicyLivesBatchRequestItem,
  PolicyLivesBatchResultItem,
} from './policy.types.js';

@Injectable()
export class PolicyService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
    private readonly tenantService: TenantService,
    private readonly brokerService: BrokerService,
    private readonly claimApiService: ClaimApiService,
  ) {}

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

  private formatDate(d: Date | null): string {
    if (!d) return '';
    return d
      .toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      .replace(/ /g, '-');
  }

  /**
   * Fetches scoped policies for the active user session and role.
   */
  async getPolicyList(
    tenantId: string,
    user: UserSessionPayload,
    role?: string,
  ): Promise<PolicyListResponse> {
    const startedAt = Date.now();
    const normalizedTenantId = tenantId.trim();
    const userRole = user.roles?.isBroker
      ? 'BROKER'
      : user.roles?.isInsurer
        ? 'INSURER'
        : 'HR';
    const activeRole = (role || userRole).toUpperCase();

    this.logger.log('Fetching policy list', PolicyService.name, {
      tenantId: normalizedTenantId,
      userId: user.userId,
      role: activeRole,
    });

    const tenantConfig =
      await this.tenantService.getFullTenantById(normalizedTenantId);
    const claimApis = tenantConfig.config?.claimApis;
    const v2Url = claimApis?.v2?.replace(/\/+$/, '');
    const v2Key = claimApis?.v2Key || '123412341234';
    const pairKey = claimApis?.pairKey || normalizedTenantId;

    const policiesMap = new Map<string, PolicyItem>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Role-specific retrieval
    if (activeRole === 'BROKER' || activeRole === 'PARTNER') {
      // Broker path: fetch via brokerService policy list
      const brokerResult = await this.brokerService.getPolicyList(
        normalizedTenantId,
        user,
      );
      const rawPolicies = (brokerResult as any)?.policies || [];

      for (const p of rawPolicies) {
        const rawPolNo = (p.polNo || p.policyNumber || '').toString().trim();
        if (!rawPolNo) continue;

        const sDate = this.parseDate(p.startDate);
        const eDate = this.parseDate(p.endDate);
        const polId = Number(p.polId || p.policyId || 0);

        let status: 'Active' | 'Expired' | 'Future' = 'Active';
        if (eDate && eDate < today) status = 'Expired';
        else if (sDate && sDate > today) status = 'Future';

        const key = `${rawPolNo.toLowerCase()}_${polId}`;
        policiesMap.set(key, {
          policyId: polId,
          policyNumber: rawPolNo,
          planName: p.planName || '',
          planType: p.planType || 'Corporate Group',
          policyHolderName: p.polHolderName || p.policyHolderName || '',
          startDate: this.formatDate(sDate),
          endDate: this.formatDate(eDate),
          startDateMs: sDate ? sDate.getTime() : undefined,
          endDateMs: eDate ? eDate.getTime() : undefined,
          status,
          corporateId: p.corpId ? Number(p.corpId) : undefined,
          dbType: p.dbType || 'MA',
        });
      }
    } else {
      // HR or Insurer path: Call Claim API v2 PolicySearch
      const hrCorpId =
        user.providerCorpId ||
        (tenantConfig.config as any)?.corpId ||
        1041805;

      if (v2Url) {
        try {
          const payload: any = {
            Range: 100,
            StartIndex: 0,
          };
          if (activeRole === 'HR' && hrCorpId > 0) {
            payload.CorporateIds = [Number(hrCorpId)];
          }

          const response = await this.httpService.post<any>(
            `${v2Url}/api/v2/PolicySearch/.json`,
            payload,
            {
              headers: {
                'Content-Type': 'application/json',
                'X-CA-SHARED-KEY': v2Key,
                Payer: pairKey,
              },
            },
          );

          const rawList =
            response?.policyDetails ||
            response?.PolicyDetails ||
            response?.policyHeaders ||
            response?.PolicyHeaders ||
            [];

          for (const p of rawList) {
            const rawPolNo = (
              p.polNo ||
              p.PolNo ||
              p.policyNumber ||
              p.PolicyNumber ||
              ''
            )
              .toString()
              .trim();
            if (!rawPolNo) continue;

            const alias = (p.aliasName || p.AliasName || '').toString().toLowerCase();
            if (alias === 'add-on policy') continue;

            const sDate = this.parseDate(
              p.polStartDate ?? p.PolStartDate ?? p.startDate ?? p.StartDate,
            );
            const eDate = this.parseDate(
              p.polEndDate ?? p.PolEndDate ?? p.endDate ?? p.EndDate,
            );
            const polId = Number(
              p.polID ?? p.polId ?? p.PolId ?? p.PolicyId ?? 0,
            );

            let status: 'Active' | 'Expired' | 'Future' = 'Active';
            if (eDate && eDate < today) status = 'Expired';
            else if (sDate && sDate > today) status = 'Future';

            const key = `${rawPolNo.toLowerCase()}_${polId}`;
            policiesMap.set(key, {
              policyId: polId,
              policyNumber: rawPolNo,
              planName:
                p.planName ||
                p.PlanName ||
                p.planType ||
                p.PlanType ||
                'Corporate Group Plan',
              planType: p.planType || p.PlanType || 'Standard Group',
              policyHolderName:
                p.polHolderName ||
                p.PolHolderName ||
                p.policyHolderName ||
                p.PolicyHolderName ||
                p.PolHldrName ||
                user.loginName ||
                'Corporate Client',
              startDate: this.formatDate(sDate),
              endDate: this.formatDate(eDate),
              startDateMs: sDate ? sDate.getTime() : undefined,
              endDateMs: eDate ? eDate.getTime() : undefined,
              status,
              corporateId: Number(p.corporateId || p.CorporateId || hrCorpId),
              dbType: p.dbType || p.DBType || 'MA',
            });
          }
        } catch (err: any) {
          this.logger.warn(
            `PolicySearch v2 failed: ${err.message}`,
            PolicyService.name,
          );
        }
      }

      // If empty, fallback to brokerService client details policies
      if (policiesMap.size === 0) {
        try {
          const fallbackRes =
            await this.brokerService.getClientDetailsPolicies(
              normalizedTenantId,
              user,
              hrCorpId,
            );
          const fallbackPolicies = fallbackRes.policies || [];
          for (const p of fallbackPolicies) {
            const rawPolNo = (p.polNo || '').toString().trim();
            if (!rawPolNo) continue;
            const sDate = this.parseDate(p.startDate);
            const eDate = this.parseDate(p.endDate);
            const polId = Number(p.polId || 0);

            let status: 'Active' | 'Expired' | 'Future' = 'Active';
            if (eDate && eDate < today) status = 'Expired';
            else if (sDate && sDate > today) status = 'Future';

            const key = `${rawPolNo.toLowerCase()}_${polId}`;
            policiesMap.set(key, {
              policyId: polId,
              policyNumber: rawPolNo,
              planName: p.planName || p.polHolderName || 'Group Health Policy',
              planType: 'Group Medical',
              policyHolderName: p.polHolderName || 'Corporate Client',
              startDate: this.formatDate(sDate),
              endDate: this.formatDate(eDate),
              startDateMs: sDate ? sDate.getTime() : undefined,
              endDateMs: eDate ? eDate.getTime() : undefined,
              status,
              corporateId: hrCorpId,
              dbType: 'MA',
            });
          }
        } catch (fbErr: any) {
          this.logger.error(
            `Fallback policy retrieval failed: ${fbErr.message}`,
            fbErr.stack,
            PolicyService.name,
          );
        }
      }
    }

    const policies = Array.from(policiesMap.values()).sort((a, b) => {
      // Active first, then by policyId desc
      if (a.status === 'Active' && b.status !== 'Active') return -1;
      if (a.status !== 'Active' && b.status === 'Active') return 1;
      return (b.endDateMs || 0) - (a.endDateMs || 0);
    });

    // Compute KPIs
    const thirtyDaysAhead = new Date();
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);

    const activeCount = policies.filter((p) => p.status === 'Active').length;
    const expiringSoonCount = policies.filter((p) => {
      if (p.status !== 'Active' || !p.endDateMs) return false;
      const end = new Date(p.endDateMs);
      return end >= today && end <= thirtyDaysAhead;
    }).length;

    this.logger.log('Policy list fetched successfully', PolicyService.name, {
      total: policies.length,
      active: activeCount,
      durationMs: Date.now() - startedAt,
    });

    return {
      success: true,
      totalCount: policies.length,
      activeCount,
      policies,
      kpis: {
        totalPolicies: policies.length,
        activePolicies: activeCount,
        totalLives: 0, // Enriched dynamically via batch lives counting
        expiringSoonCount,
      },
    };
  }

  /**
   * Fetches paginated beneficiaries belonging to a policy.
   */
  async getBeneficiariesForPolicy(
    tenantId: string,
    policyNo: string,
    policyId?: number,
    corpId?: number,
    startIndex: number = 0,
    range: number = 100,
  ): Promise<PolicyBeneficiariesResponse> {
    const normalizedTenantId = tenantId.trim();
    const tenantConfig =
      await this.tenantService.getFullTenantById(normalizedTenantId);
    const claimApis = tenantConfig.config?.claimApis;
    const v2Url = claimApis?.v2?.replace(/\/+$/, '');
    const v2Key = claimApis?.v2Key || '123412341234';
    const pairKey = claimApis?.pairKey || normalizedTenantId;

    if (!v2Url) {
      throw new InternalServerErrorException(
        'Claim API v2 URL not configured for tenant',
      );
    }

    const payload: any = {
      PolicyNo: policyNo ? policyNo.trim() : null,
      Range: Math.max(1, Math.min(100, range)),
      StartIndex: Math.max(0, startIndex),
    };
    if (policyId && policyId > 0) {
      payload.PolicyIds = [Number(policyId)];
    } else if (corpId && corpId > 0) {
      payload.PolicyCorpIds = [Number(corpId)];
    }

    try {
      const response = await this.httpService.post<any>(
        `${v2Url}/api/v2/BeneficiarySearch/.json`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-CA-SHARED-KEY': v2Key,
            Payer: pairKey,
          },
        },
      );

      const rawBeneficiaries =
        response?.BeneficiaryDetails || response?.beneficiaryDetails || [];
      const totalCount =
        response?.TotalRecordsCount ||
        response?.totalRecordsCount ||
        rawBeneficiaries.length;

      const beneficiaries: BeneficiaryItem[] = rawBeneficiaries.map(
        (b: any) => {
          const rawRel = (
            b.benefRelName ||
            b.Relation ||
            b.relation ||
            b.Relationship ||
            ''
          ).trim();
          const relation =
            rawRel.toLowerCase() === 'self' || rawRel.toLowerCase() === 'primary'
              ? 'Insured'
              : rawRel || 'Dependent';

          const first = (b.benefName || b.Name || b.firstName || b.FirstName || '').trim();
          const last = (b.benefLastName || b.LastName || b.lastName || '').trim();
          const empId = (
            b.primaryBenefDetails?.actualEmpCode ||
            b.actualEmpCode ||
            b.priBenefEmpCode ||
            b.PriBenefEmpCode ||
            b.benefEmpNo ||
            b.EmpNo ||
            b.empId ||
            ''
          ).trim();

          const isActive = b.benefActive !== false && b.Status !== 'Inactive' && b.memberStatus !== 'Inactive';

          return {
            maid: Number(b.benefMediAssistID || b.MAID || b.maid || b.MediAssistId || 0),
            firstName: first,
            lastName: last,
            empId,
            relation,
            gender: (b.benefGender || b.Gender || b.gender || '').trim(),
            memberStatus: isActive ? 'Active' : 'Inactive',
            policyNumber: policyNo || b.policyDetail?.polNo || '',
            policyId: policyId || Number(b.policyDetail?.polID || 0),
          };
        },
      );

      return {
        success: true,
        count: beneficiaries.length,
        totalCount,
        beneficiaries,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to fetch beneficiaries for policy ${policyNo}: ${err.message}`,
        err.stack,
        PolicyService.name,
      );
      return {
        success: false,
        count: 0,
        totalCount: 0,
        beneficiaries: [],
      };
    }
  }

  /**
   * Fetches documents and links for a policy (Claim Form, Network Hospital, dynamic attachments).
   */
  async getPolicyDocuments(
    tenantId: string,
    policyId: number,
  ): Promise<PolicyDocumentsResponse> {
    const normalizedTenantId = tenantId.trim();
    const tenantConfig =
      await this.tenantService.getFullTenantById(normalizedTenantId);
    const claimApis = tenantConfig.config?.claimApis;
    const v2Url = claimApis?.v2?.replace(/\/+$/, '');
    const v2Key = claimApis?.v2Key || '123412341234';
    const pairKey = claimApis?.pairKey || normalizedTenantId;

    const documents: PolicyDocumentItem[] = [
      {
        documentId: 'claim_form_standard',
        fileName: 'Claim Form',
        downloadUrl: '/Resources/Documents/PIHClaimForm.pdf',
        documentType: 'claim_form',
      },
      {
        documentId: 'network_hospital_directory',
        fileName: 'Network Hospital',
        downloadUrl: '/dashboard?view=search-medical-provider',
        documentType: 'network_hospital',
      },
    ];

    if (v2Url && policyId > 0) {
      try {
        const payload = {
          policyIds: [Number(policyId)],
          dbType: 'MA',
        };

        const response = await this.httpService.post<any>(
          `${v2Url}/api/v2/policy/attachments/`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CA-SHARED-KEY': v2Key,
              Payer: pairKey,
            },
          },
        );

        const attachments = response?.Attachments || response?.attachments || [];
        for (const att of attachments) {
          // Legacy parity: Filter to POLICY_DOCUMENT_ATTACHMENT (enum value 1)
          const attType = att.attachmentType ?? att.AttachmentType;
          if (
            attType !== undefined &&
            attType !== null &&
            attType !== 1 &&
            String(attType).toLowerCase() !== 'policy_document_attachment'
          ) {
            continue;
          }

          const fileGuid =
            att.dmsFilePath ||
            att.DMSFilePath ||
            att.fileGuid ||
            att.FileGuid ||
            '';
          if (!fileGuid) continue;

          const fileName =
            att.fileDisplayName ||
            att.FileDisplayName ||
            att.fileName ||
            att.FileName ||
            att.fileOriginalName ||
            att.FileOriginalName ||
            'Policy Document.pdf';

          documents.push({
            documentId: att.attachmentID || att.AttachmentID || att.attachmentId || att.Id || fileGuid,
            fileName,
            downloadUrl: `/api/policy/attachment/${encodeURIComponent(fileGuid)}?fileName=${encodeURIComponent(fileName)}`,
            documentType: 'policy_attachment',
            isExternal: true,
          });
        }
      } catch (err: any) {
        this.logger.warn(
          `Could not load attachments for policy ${policyId}: ${err.message}`,
          PolicyService.name,
        );
      }
    }

    return {
      success: true,
      documents,
    };
  }

  /**
   * Downloads a policy document attachment from central DMS by its fileGuid / FileIdentifier.
   */
  async downloadDmsAttachment(
    tenantId: string,
    fileGuid: string,
    fallbackFileName?: string,
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const isLawton =
      tenantId.includes('Lawton') ||
      tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

    let dmsHost = isLawton
      ? 'https://uat-lawton-dms.lawtonasia.com'
      : 'http://coredms.medibuddy.in';

    let appId = isLawton ? '9240' : '9237';
    let appUrl = isLawton
      ? 'https://uat-maglobal.lawtonasia.com/'
      : 'https://maglobal.mayfairwecare.in/';

    try {
      const tenantConfig = await this.tenantService.getFullTenantById(tenantId.trim());
      if (tenantConfig?.config?.auth?.appId) {
        appId = String(tenantConfig.config.auth.appId);
      }
      if (tenantConfig?.config?.app?.url) {
        appUrl = tenantConfig.config.app.url.replace(/\/?$/, '/');
      }
    } catch {
      // Use defaults
    }

    const res = await fetch(`${dmsHost}/DownloadFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        mbappid: appId,
        mbappurl: appUrl,
      },
      body: JSON.stringify({ FileIdentifier: fileGuid }),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(`DMS failed to download file ${fileGuid}: status ${res.status}`);
    }

    const data = (await res.json()) as any;
    if (!data?.fileBytes) {
      throw new InternalServerErrorException(`No file content returned from DMS for fileGuid: ${fileGuid}`);
    }

    const buffer = Buffer.from(data.fileBytes, 'base64');
    const resolvedFileName = data.fileName || fallbackFileName || 'document.pdf';
    const ext = resolvedFileName.split('.').pop()?.toLowerCase();

    let contentType = 'application/pdf';
    if (ext === 'png') contentType = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
    else if (ext === 'gif') contentType = 'image/gif';
    else if (ext === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === 'doc') contentType = 'application/msword';
    else if (ext === 'xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === 'xls') contentType = 'application/vnd.ms-excel';

    return { buffer, contentType, fileName: resolvedFileName };
  }

  /**
   * Fetches active lives count for a batch of policies in parallel.
   */
  async getPolicyLivesCountBatch(
    tenantId: string,
    requests: PolicyLivesBatchRequestItem[],
  ): Promise<{ success: boolean; counts: PolicyLivesBatchResultItem[] }> {
    if (!requests || requests.length === 0) {
      return { success: true, counts: [] };
    }

    const normalizedTenantId = tenantId.trim();
    const tenantConfig =
      await this.tenantService.getFullTenantById(normalizedTenantId);
    const claimApis = tenantConfig.config?.claimApis;
    const v2Url = claimApis?.v2?.replace(/\/+$/, '');
    const v2Key = claimApis?.v2Key || '123412341234';
    const pairKey = claimApis?.pairKey || normalizedTenantId;

    if (!v2Url) {
      return {
        success: true,
        counts: requests.map((r) => ({ policyId: r.policyId, count: 0 })),
      };
    }

    const tasks = requests.map(async (req) => {
      try {
        const payload: any = {
          policyId: Number(req.policyId),
          dbType: 'MA',
        };
        if (req.startDateMs) {
          const sec = req.startDateMs > 10000000000 ? Math.floor(req.startDateMs / 1000) : req.startDateMs;
          payload.policyStartDate = `/Date(${sec})/`;
        }

        const response = await this.httpService.post<any>(
          `${v2Url}/api/v2/PolicyLives/`,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-CA-SHARED-KEY': v2Key,
              Payer: pairKey,
            },
          },
        );

        const lives =
          response?.NewLives?.Lives ||
          response?.newLives?.lives ||
          response?.Lives ||
          response?.lives ||
          0;

        return { policyId: req.policyId, count: Number(lives) };
      } catch {
        return { policyId: req.policyId, count: 0 };
      }
    });

    const results = await Promise.all(tasks);
    return { success: true, counts: results };
  }
}
