import { Injectable, Logger } from '@nestjs/common';
import { LoggingService } from '../../common/logging/logging.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { BrokerService } from '../broker/broker.service.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { ClaimSearchDto } from './dto/claim-search.dto.js';
import {
  NormalizedClaim,
  NormalizedClaimDetails,
  ClaimAuditItem,
} from './claims.types.js';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly loggingService: LoggingService,
    private readonly tenantService: TenantService,
    private readonly brokerService: BrokerService,
  ) {}

  /**
   * Retrieves corporate entities for the active user.
   */
  async getEntities(tenantId: string, user: UserSessionPayload) {
    try {
      const isBroker = Boolean(user.roles?.isBroker || user.isAdminBroker);
      if (isBroker) {
        const entitiesRes = await this.brokerService.getClientDetailsEntities(
          tenantId,
          user,
        );
        return { isSuccess: true, entities: entitiesRes.entities || [] };
      }

      // For HR users, return their primary corporate entity
      return {
        isSuccess: true,
        entities: [
          {
            corpId: user.providerCorpId || 0,
            corpName: (user as any).companyName || user.userName || 'Corporate Entity',
          },
        ],
      };
    } catch (err: any) {
      this.logger.error(`Error in getEntities: ${err.message}`, err.stack);
      return { isSuccess: false, entities: [] };
    }
  }

  /**
   * Retrieves policies for a specific corporate entity.
   */
  async getPolicies(
    tenantId: string,
    user: UserSessionPayload,
    corpId?: number,
  ) {
    try {
      const effectiveCorpId = corpId || user.providerCorpId;
      const res = await this.brokerService.getClientDetailsPolicies(
        tenantId,
        user,
        effectiveCorpId,
      );

      const policies = (res.policies || []).map((p) => ({
        polId: p.polId,
        polNo: p.polNo,
        polHolderName: p.polHolderName,
        startDate: p.startDate,
        endDate: p.endDate,
      }));

      return { isSuccess: true, policies };
    } catch (err: any) {
      this.logger.error(`Error in getPolicies: ${err.message}`, err.stack);
      return { isSuccess: false, policies: [] };
    }
  }

  /**
   * Core unified Claim Search across Mayfair & Lawton portals.
   */
  async searchClaims(
    tenantId: string,
    user: UserSessionPayload,
    dto: ClaimSearchDto,
  ): Promise<{ isSuccess: boolean; total: number; claims: NormalizedClaim[]; message?: string }> {
    const trimmedTenantId = (tenantId || '').trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const isLawton =
      trimmedTenantId.includes('Lawton') ||
      trimmedTenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

    try {
      if (isLawton) {
        return await this.searchLawtonClaims(trimmedTenantId, user, dto, tenantConfig);
      } else {
        return await this.searchMayfairClaims(trimmedTenantId, user, dto, tenantConfig);
      }
    } catch (err: any) {
      this.logger.error(`Error searching claims: ${err.message}`, err.stack);
      return {
        isSuccess: false,
        total: 0,
        claims: [],
        message: 'Unable to retrieve claims. Please check your criteria.',
      };
    }
  }

  /**
   * Lawton-specific Claim Search Logic:
   * 1. If searching by Claim Reference / Number -> direct claimDetails query.
   * 2. If searching by Name / Staff ID -> resolve member MAIDs, then call NonCMS claims search.
   * 3. Fallback to Claim API v2 if NonCMS has no matching records.
   */
  private async searchLawtonClaims(
    tenantId: string,
    user: UserSessionPayload,
    dto: ClaimSearchDto,
    tenantConfig: any,
  ): Promise<{ isSuccess: boolean; total: number; claims: NormalizedClaim[]; message?: string }> {
    const trimmedTenantId = (tenantId || '').trim();
    const dxUrl =
      tenantConfig.config?.dataexchange?.api ||
      tenantConfig.config?.claimApis?.v1Lawton;

    if (!dxUrl) {
      this.logger.error(`Missing dataexchange.api in TenantConfiguration for tenant ${trimmedTenantId}`);
      return {
        isSuccess: false,
        total: 0,
        claims: [],
        message: 'Data exchange gateway configuration is missing in TenantConfiguration.',
      };
    }

    const normalizedClaims: NormalizedClaim[] = [];

    // 1. Direct Claim Number / Reference Search
    if (dto.claimNo?.trim()) {
      const claimQuery = dto.claimNo.trim();
      try {
        const res = await fetch(`${dxUrl.replace(/\/+$/, '')}/memberportal/search/claimDetails/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clmReferenceNo: claimQuery }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => null);
          const v = data?.claimDetailsView;
          if (v && (v.claimReferenceNo || (v.claimNumber && v.claimNumber > 0))) {
            const benefFirst = v.benefName || '';
            const benefLast = v.benefLastName || '';
            const benefName = `${benefFirst} ${benefLast}`.trim() || v.pribeneficiaryName || '';

            normalizedClaims.push({
              claimId: String(v.claimReferenceNo || v.claimNumber),
              claimReferenceNo: v.claimReferenceNo || String(v.claimNumber),
              actualClaimId: Number(v.claimNumber || 0),
              firstName: benefFirst,
              lastName: benefLast,
              beneficiaryName: benefName,
              employeeId: v.priBenefEmpCode || '',
              policyNumber: v.policyNumber || '',
              claimType: this.mapClaimType(v.clmTypeDesc, true),
              treatmentDate: this.parseDotNetDate(v.clmDOA),
              dateOfDischarge: this.parseDotNetDate(v.clmDOD) || undefined,
              claimedAmount: Number(v.incurredAmount || v.clmAmount || 0),
              approvedAmount: Number(v.agreeAmountBasic || v.clmApprovedAmt || 0),
              currency: v.tpaCurrency || v.currency || 'THB',
              status: v.statusName || '',
              isPastClaim: dto.claimType === 'Past',
            });
            return { isSuccess: true, total: 1, claims: normalizedClaims };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Lawton claimDetails lookup failed: ${err.message}`);
      }
    }

    // 2. Exact Legacy Lawton Pipeline: BeneficiarySearch MAIDs -> Non-CMS Claim Search on Lawton DX
    if (dto.corpId || dto.empName?.trim() || dto.empCode?.trim()) {
      try {
        const v2Url = tenantConfig.config?.claimApis?.v2?.replace(/\/+$/, '');
        const v2Key = tenantConfig.config?.claimApis?.v2Key;

        if (!v2Url || !v2Key) {
          this.logger.error(`Missing claimApis.v2 or v2Key in TenantConfiguration for tenant ${trimmedTenantId}`);
          return {
            isSuccess: false,
            total: 0,
            claims: [],
            message: 'Claim API v2 configuration is missing in TenantConfiguration.',
          };
        }

        const benefPayload: Record<string, any> = {
          Range: 100,
          StartIndex: 0,
        };
        if (dto.corpId && Number(dto.corpId) > 0) {
          benefPayload.PolicyCorpIds = [Number(dto.corpId)];
        }
        if (dto.empCode?.trim()) {
          benefPayload.EmployeeNo = dto.empCode.trim();
        }
        if (dto.empName?.trim()) {
          benefPayload.BeneficiaryName = dto.empName.trim();
        }

        const bRes = await fetch(`${v2Url}/api/v2/BeneficiarySearch/.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CA-SHARED-KEY': v2Key,
            Payer: tenantId,
          },
          body: JSON.stringify(benefPayload),
        });

        if (bRes.ok) {
          const bData = await bRes.json().catch(() => null);
          const benefList = bData?.BeneficiaryDetails || bData?.beneficiaryDetails || [];
          const maids = [...new Set(
            benefList
              .map((b: any) => Number(b.benefMediAssistID || b.BenefMediAssistID))
              .filter((id: number) => !isNaN(id) && id > 0)
          )];

          if (maids.length > 0) {
            const nonCmsRes = await fetch(`${dxUrl.replace(/\/+$/, '')}/memberportal/search/noncmsclaim/claims/`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                MaIds: maids,
                IsDHSMember: false,
              }),
            });

            if (nonCmsRes.ok) {
              const nonCmsData = await nonCmsRes.json().catch(() => null);
              const rawClaims = nonCmsData?.claims || nonCmsData?.Claims || [];

              if (rawClaims.length > 0) {
                let parsedClaims: NormalizedClaim[] = rawClaims.map((c: any) => {
                  const benefFirst = (c.benefName || c.BenefName || '').trim();
                  const benefLast = (c.benefLastName || c.BenefLastName || '').trim();
                  let fullName = benefFirst;
                  if (benefLast && !benefFirst.toLowerCase().includes(benefLast.toLowerCase())) {
                    fullName = `${benefFirst} ${benefLast}`.trim();
                  }
                  if (!fullName) fullName = c.employeeName || '';

                  const clmTypeDesc = c.claimType || c.ClaimType || '';
                  const mappedType = this.mapClaimType(clmTypeDesc, true);

                  const refNo = c.claimReferenceNo || c.ClaimReferenceNo || '';
                  const rawClaimId = (c.claimId || c.ClaimId || c.tpaClmNo || '').toString().trim();
                  // Exact legacy logic from GetClaimIdDisplay: !string.IsNullOrEmpty(claim.ClaimId) ? claim.ClaimId : claim.ClaimReferenceNo
                  const displayClaimId = rawClaimId && rawClaimId !== '0' && rawClaimId !== 'null' ? rawClaimId : refNo;

                  return {
                    claimId: displayClaimId,
                    claimReferenceNo: refNo || displayClaimId,
                    actualClaimId: Number(c.actualClaimId || c.ActualClaimId || 0),
                    firstName: benefFirst,
                    lastName: benefLast,
                    beneficiaryName: fullName,
                    employeeId: c.employeeId || c.EmployeeId || '',
                    policyNumber: c.policyNumber || c.PolicyNumber || '',
                    claimType: mappedType,
                    treatmentDate: this.parseDotNetDate(c.doa || c.DOA || c.claimReceivedDate),
                    dateOfDischarge: this.parseDotNetDate(c.dod || c.DOD) || undefined,
                    claimedAmount: Number(c.clmAmount || c.ClmAmount || 0),
                    approvedAmount: Number(c.clmApprovedAmt || c.paApprovedAmt || 0),
                    currency: c.currency || c.Currency || 'THB',
                    status: c.status || c.Status || '',
                    isPastClaim: dto.claimType === 'Past',
                  };
                });

                // Apply policy filter if specific policy was chosen
                if (dto.polNo?.trim() && dto.polNo !== '0' && dto.polNo.toLowerCase() !== 'all policies') {
                  const filterPol = dto.polNo.trim().toLowerCase();
                  parsedClaims = parsedClaims.filter(
                    (c) => c.policyNumber?.toLowerCase() === filterPol,
                  );
                }

                // Apply name filter if user typed in search box
                if (dto.empName?.trim()) {
                  const q = dto.empName.trim().toLowerCase();
                  parsedClaims = parsedClaims.filter(
                    (c) =>
                      c.beneficiaryName?.toLowerCase().includes(q) ||
                      c.firstName?.toLowerCase().includes(q) ||
                      c.lastName?.toLowerCase().includes(q),
                  );
                }

                // Apply staff ID filter if user typed in search box
                if (dto.empCode?.trim()) {
                  const q = dto.empCode.trim().toLowerCase();
                  parsedClaims = parsedClaims.filter((c) =>
                    c.employeeId?.toLowerCase().includes(q),
                  );
                }

                return {
                  isSuccess: true,
                  total: parsedClaims.length,
                  claims: parsedClaims,
                };
              }
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`Lawton NonCMS pipeline error: ${err.message}`, err.stack);
      }
    }

    return {
      isSuccess: true,
      total: 0,
      claims: [],
      message: 'No claims found matching your query criteria.',
    };
  }

  /**
   * Mayfair-specific Claim Search Logic using Claim API v2.
   */
  private async searchMayfairClaims(
    tenantId: string,
    user: UserSessionPayload,
    dto: ClaimSearchDto,
    tenantConfig: any,
  ): Promise<{ isSuccess: boolean; total: number; claims: NormalizedClaim[]; message?: string }> {
    const v2Claims = await this.queryClaimApiV2(tenantId, tenantConfig, dto);
    return {
      isSuccess: true,
      total: v2Claims.length,
      claims: v2Claims,
    };
  }

  /**
   * Shared helper for querying IPMI Claim API v2 (/api/v2/ClaimSearch/.json).
   */
  private async queryClaimApiV2(
    tenantId: string,
    tenantConfig: any,
    dto: ClaimSearchDto,
  ): Promise<NormalizedClaim[]> {
    const v2Url = tenantConfig.config?.claimApis?.v2?.replace(/\/+$/, '');
    const v2Key = tenantConfig.config?.claimApis?.v2Key;
    if (!v2Url || !v2Key) return [];

    const payload: Record<string, any> = {
      Range: dto.limit || 50,
      StartIndex: dto.page ? (dto.page - 1) * (dto.limit || 50) : 0,
    };

    if (dto.corpId && Number(dto.corpId) > 0) {
      payload.CorporateIds = [Number(dto.corpId)];
    }
    if (dto.polNo?.trim()) {
      payload.PolicyNumber = dto.polNo.trim();
    }
    if (dto.empCode?.trim()) {
      payload.PriBenefEmpCode = dto.empCode.trim();
    }
    if (dto.claimNo?.trim()) {
      const num = Number(dto.claimNo.trim());
      if (!isNaN(num) && num > 0) {
        payload.ClaimIds = [num];
      } else {
        payload.InsurerClmRefNo = dto.claimNo.trim();
      }
    }
    if (dto.empName?.trim()) {
      payload.PolicyHolderName = dto.empName.trim();
    }
    if (dto.startDate) {
      payload.ClaimDateOfAdmissionStart = dto.startDate;
    }
    if (dto.endDate) {
      payload.ClaimDateOfAdmissionEnd = dto.endDate;
    }

    try {
      const res = await fetch(`${v2Url}/api/v2/ClaimSearch/.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': v2Key,
          Payer: tenantId,
          LoadArchive: 'True',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const results = data?.ClaimSearchResults || data?.claimSearchResults || [];

      const mapped = results.map((item: any) => {
        const c = item.ClaimDetails || item;
        const b = item.benefDetails || item.BeneficiaryDetails || item.pribenefDetails || {};
        const p = item.policyDetails || item.PolicyDetails || {};

        const claimId = String(item.claimId || c.Clm_ClaimId || c.ActualClaimId || c.ClaimId || '');
        const claimRef = String(item.claimReferenceNumber || c.Clm_RefNo || c.ClaimReferenceNo || claimId);
        const actualClaimId = Number(item.claimId || c.Clm_ClaimId || c.ActualClaimId || 0);

        const benefFirst = b.benefName || b.Benef_FirstName || b.priBeneficiaryName || item.beneficiaryName || '';
        const benefLast = b.benefLastName || b.Benef_LastName || '';
        const fullName = `${benefFirst} ${benefLast}`.trim() || item.beneficiaryName || '';

        const empId = b.priBenefEmpCode || b.Benef_EmpCode || item.employeeId || '';
        const polNo = p.polNo || p.Pol_PolicyNumber || p.policyNumber || item.policyNumber || '';
        const clmType = this.mapClaimType(item.claimType || c.Clm_TypeDesc || c.ClaimType || item.claimSubType);

        const treatmentDate = this.parseDotNetDate(item.claimDOA || c.Clm_DOA || c.DOA || item.receivedOn);
        const dischargeDate = this.parseDotNetDate(item.claimDOD || c.Clm_DOD || c.DOD);

        const claimed = Number(item.claimedAmt ?? c.Clm_ClaimAmount ?? c.ClmAmount ?? item.clmAmount ?? 0);
        const approved = Number(item.approvedAmt ?? c.Clm_ApprovedAmount ?? c.ApprovedAmt ?? item.clmApprovedAmt ?? 0);
        const currency = item.clmUWCurrency || item.clmCurrency || c.Clm_Currency || p.pol_Currency || 'THB';
        const status = item.currentClaimStatus || item.claimExternalStatus || c.Clm_StatusName || c.Status || '';

        return {
          claimId,
          claimReferenceNo: claimRef,
          actualClaimId,
          firstName: benefFirst,
          lastName: benefLast,
          beneficiaryName: fullName,
          employeeId: empId,
          policyNumber: polNo,
          claimType: clmType,
          treatmentDate,
          dateOfDischarge: dischargeDate || undefined,
          claimedAmount: claimed,
          approvedAmount: approved,
          currency,
          status,
          isPastClaim: dto.claimType === 'Past',
        };
      });

      // If user filtered by empName, filter client-side as well
      if (dto.empName?.trim()) {
        const queryName = dto.empName.trim().toLowerCase();
        return mapped.filter((m: NormalizedClaim) =>
          m.beneficiaryName.toLowerCase().includes(queryName)
        );
      }

      return mapped;
    } catch (err: any) {
      this.logger.warn(`Claim API v2 search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetches full claim details, audit trail, and breakdown.
   */
  async getClaimDetails(
    tenantId: string,
    user: UserSessionPayload,
    claimReferenceNo: string,
  ): Promise<{ isSuccess: boolean; details: NormalizedClaimDetails | null; message?: string }> {
    const trimmedTenantId = (tenantId || '').trim();
    const tenantConfig = await this.tenantService.getFullTenantById(trimmedTenantId);
    const dxUrl =
      tenantConfig.config?.dataexchange?.api ||
      tenantConfig.config?.claimApis?.v1Lawton;

    if (!dxUrl) {
      this.logger.error(`Missing dataexchange.api in TenantConfiguration for tenant ${trimmedTenantId}`);
      return {
        isSuccess: false,
        details: null,
        message: 'Data exchange gateway configuration is missing in TenantConfiguration.',
      };
    }

    try {
      // 1. Try DX claimDetails
      const res = await fetch(`${dxUrl.replace(/\/+$/, '')}/memberportal/search/claimDetails/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clmReferenceNo: claimReferenceNo }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const v = data?.claimDetailsView;
        if (v && (v.claimReferenceNo || v.tpaClmNo || (v.claimNumber && v.claimNumber > 0))) {
          const auditTrail: ClaimAuditItem[] = (v.claimAuditDetails || []).map((a: any) => {
            const rawStatus = (a.claimStatus || a.ClaimStatus || '').trim();
            return {
              status: rawStatus.toUpperCase() === 'CSUB' ? 'Claim Received' : rawStatus,
              date: this.parseDotNetDate(a.claimAuditTime || a.ClaimAuditTime),
            };
          });

          const bFirst = (v.beneficiary?.BenefName || v.benefName || '').trim();
          const bLast = (v.beneficiary?.BenefLastName || v.benefLastName || '').trim();
          let bFull = bFirst;
          if (bLast && !bFirst.toLowerCase().includes(bLast.toLowerCase())) {
            bFull = `${bFirst} ${bLast}`.trim();
          }

          const isLawton = trimmedTenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';
          const displayClaimNumber = (v.tpaClmNo || (v.claimNumber && v.claimNumber > 0 ? String(v.claimNumber) : '') || v.claimReferenceNo || claimReferenceNo).trim();

          const rawStatus = (v.statusName || v.status || '').trim();
          const displayStatus = rawStatus.toUpperCase() === 'CSUB' ? 'Claim Received' : rawStatus;

          const details: NormalizedClaimDetails = {
            claimReferenceNo: v.claimReferenceNo || claimReferenceNo,
            claimNumber: displayClaimNumber,
            beneficiaryName: bFull,
            policyNumber: v.policyNumber || '',
            claimType: this.mapClaimType(v.clmTypeDesc, isLawton),
            dateOfAdmission: this.parseDotNetDate(v.ClmDOA || v.clmDOA),
            dateOfDischarge: this.parseDotNetDate(v.ClmDOD || v.clmDOD),
            claimedAmount: Number(v.incurredAmount || v.clmAmount || 0),
            payableAmount: Number(v.agreeAmountBasic || v.clmApprovedAmt || 0),
            currency: v.tpaCurrency || v.currency || 'THB',
            currentStatus: displayStatus,
            auditTrail,
          };

          return { isSuccess: true, details };
        }
      }

      return { isSuccess: false, details: null, message: 'No claim details available for this record.' };
    } catch (err: any) {
      this.logger.error(`Error in getClaimDetails: ${err.message}`, err.stack);
      return { isSuccess: false, details: null, message: 'Failed to fetch claim details.' };
    }
  }

  /**
   * Helper to parse ASP.NET /Date(milliseconds-0000)/ and ISO timestamps.
   */
  private parseDotNetDate(val: any): string {
    if (!val) return '';
    if (typeof val === 'string' && val.includes('/Date(')) {
      const match = val.match(/\/Date\((\d+)/);
      if (match) return new Date(Number(match[1])).toISOString();
    }
    try {
      const d = new Date(val);
      return isNaN(d.getTime()) || d.getFullYear() <= 1 ? '' : d.toISOString();
    } catch {
      return '';
    }
  }

  /**
   * Maps shorthand claim type codes to clean user-friendly labels.
   */
  private mapClaimType(type?: string, isLawton = false): string {
    if (!type) return '';
    const trimmed = type.trim().toLowerCase();
    if (isLawton) {
      if (trimmed.includes('domi') || trimmed === 'outpatient') return 'Outpatient';
      if (trimmed.includes('reimb') || trimmed.includes('hosp') || trimmed === 'inpatient') return 'Inpatient';
      return type;
    }
    if (trimmed === 'hosp' || trimmed === 'inpatient') return 'Inpatient';
    if (trimmed === 'domi' || trimmed === 'outpatient') return 'Outpatient';
    if (trimmed === 'pa' || trimmed === 'preauth') return 'Pre-Authorization';
    if (trimmed === 'reimbursement') return 'Reimbursement';
    return type;
  }
}
