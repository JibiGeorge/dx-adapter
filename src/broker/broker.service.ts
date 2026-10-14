import { Injectable } from "@nestjs/common";
import { UserSessionPayload } from "../auth/auth.types";
import { DashboardResponse } from "./broker.types";
import { TenantConfigTypes } from "../tenant/tenant.types";
import { TenantService } from "../tenant/tenant.service";
import { HttpService } from "../../common/http/http.service";
import { ClaimApiService } from "../integrations/claim-api/claim-api.service";

@Injectable()
export class BrokerService {
    constructor(
        private readonly tenantService: TenantService,
        private readonly claimApiService: ClaimApiService
    ) { }

    async getBrokerData(tenantId: string, user: UserSessionPayload): Promise<DashboardResponse> {
        let brokerCorpName = 'Broker Portal';
        let corpIds: number[] = [];
        let ids = [];

        try {

            const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(tenantId.trim());

            const claimApiUrl = tenantConfig.config.claimApis.v1?.replace(/\/+$/, '');

            if (!claimApiUrl) {
                throw new Error('Claim API URL is not configured for this tenant.');
            }

            const policiesData = await this.claimApiService.searchPoliciesByAgent(
                user.brokerId || '',
                tenantConfig.tenantId == 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5' ? [120, 93] : [],
                claimApiUrl,
            );

            const headers: any[] = policiesData?.policyHeaders || policiesData?.policyHeaders || [];

            if (policiesData?.policyHeaders?.length > 0) {
                brokerCorpName = policiesData?.policyHeaders[0]?.PolicyHolderName || policiesData?.policyHeaders[0]?.policyHolderName || brokerCorpName;
            }

            ids = [
                ...new Set(
                    headers
                        .map((policy: any) =>
                            Number(
                                policy.CorporateId ??
                                policy.corporateId ??
                                0,
                            ),
                        )
                        .filter(
                            (id: number) => Number.isFinite(id) && id > 0,
                        ),
                ),
            ];
            
            // Apply the Lawton partner / broker UAT fallback.
            if (ids.length === 0 || (ids.length === 1 && ids[0] === 1041805)) {
                if (tenantId.trim() === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5' || String(user.brokerId) === '120') {
                    ids = [
                        1422143,
                        1422123,
                        1422130,
                        1422104,
                        1422138,
                        1422145,
                        1422136,
                        1422147,
                        1422146,
                        1422144,
                    ];
                } else {

                    const groupCorpId = Number(user?.providerGroupCorpId || 0);

                    const new_ids = new Set<number>();

                    if (groupCorpId > 0) {
                        const groupCorpResponse = await this.claimApiService.searchPoliciesByGroupCorp(
                            user.providerGroupCorpId,
                            tenantId,
                            tenantConfig.config.claimApis.v2,
                            tenantConfig.config.claimApis.v2Key || '',
                            false
                        );

                        const policies: any[] = groupCorpResponse?.policyDetails || [];
                        for (const p of policies) {
                            const cid = Number(p.pol_CorporateId ?? p.CorporateId ?? p.corporateId ?? 0);
                            if (cid > 0) new_ids.add(cid);
                        }

                        if (new_ids.size === 0) new_ids.add(groupCorpId);
                    }

                    if (new_ids.size === 0) new_ids.add(1041805)

                    ids = [...new_ids];
                    // (req as any).__hrCorpIds = result;
                }
            }

            corpIds = ids;

            // (req as any).__brokerCorpIds = ids;

            const isAdminBroker = !!user.isAdminBroker;

            return {
                success: true,
                userName: user.userName || user.loginName,
                brokerName: brokerCorpName,
                brokerId: user.brokerId || '120',
                isAdminBroker,
                isLawton: tenantId.trim() === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5' ? true : false,
                corpId: corpIds[0] || 0,
                corpIds,
                welcomeBrandingName: tenantId.trim() === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5' ? 'LawtonAsia' : 'Mayfair We care',
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
                    brokerId: Number(user.brokerId || '120'),
                    departmentId: user.departmentId || '',
                    dashboards: tenantConfig.config.additionalConfigs.brokerDashboards,
                },
            }


        } catch (error) {
            throw error;
        }
    }
}