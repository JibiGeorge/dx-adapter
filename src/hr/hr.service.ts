import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { UserSessionPayload } from "../auth/auth.types.js";
import { LoggingService } from "../../common/logging/logging.service.js";
import { ClaimApiService } from "../integrations/claim-api/claim-api.service.js";
import { TenantConfigTypes } from "../tenant/tenant.types.js";
import { TenantService } from "../tenant/tenant.service.js";
import { LAWTON_TENANT_ID } from "../broker/broker.constants.js";
import { HRDashboardResponse } from "./hr.types.js";

@Injectable()
export class HRService {
    constructor(
        private readonly logger: LoggingService,
        private readonly claimService: ClaimApiService,
        private readonly tenantService: TenantService,
    ) { }

    async getHRData(tenantId: string, user: UserSessionPayload): Promise<HRDashboardResponse> {
        const normalizedTenantId = tenantId.trim();
        const isLawton = normalizedTenantId === LAWTON_TENANT_ID;

        const tenantConfig: TenantConfigTypes =
            await this.tenantService.getFullTenantById(
                normalizedTenantId,
            );

        if (!tenantConfig) {
            throw new InternalServerErrorException('Tenant not found');
        }

        const claimApis = tenantConfig.config?.claimApis;

        const corpIds = await this.claimService.resolveFallbackCorpIds(
            normalizedTenantId,
            user,
            tenantConfig,
            isLawton,
        );
        const corpId = corpIds[0] || this.getCorpId(tenantConfig, user);

        try {
            const policiesRes = await this.claimService.searchPolicies(
                corpIds,
                claimApis?.v2 || '',
                claimApis?.v2Key || '',
                normalizedTenantId,
                false
            );

            const policies = policiesRes?.policyDetails ?? policiesRes?.PolicyDetails ?? [];
            const firstPolicy = Array.isArray(policies) ? policies[0] : undefined;
            const corporateName =
                firstPolicy?.polHolderName ||
                firstPolicy?.PolHolderName ||
                firstPolicy?.policyHolderName ||
                firstPolicy?.PolicyHolderName ||
                'Corporate Group';

            return {
                success: true,
                userName: user.userName || user.loginName || '',
                corporateName,
                corpId,
                welcomeBrandingName: isLawton ? 'LawtonAsia' : 'Mayfair We care',
                customHRPage: 'TPAIndexHRMWC',
                isCorpHR: true,
                isLawton,
                roleAccess: {
                    showMAestroDashboard: true,
                    showEcard: true,
                    showSearchHospital: true,
                    showMemberEnrollment: true,
                    showTrackClaim: true,
                    showPolicyDetails: true,
                    showProfile: true,
                    maestroDashboards: {
                        showPADashboard: true,
                        showWebMISReport: true,
                    },
                },
                hasSubCorporates: corpIds.length > 1,
                reportsConfig: {
                    corpId,
                    dashboards: tenantConfig.config?.additionalConfigs?.hrDashboards || [],
                },
            };
        } catch (error) {
            const err =
                error instanceof Error
                    ? error
                    : new Error(String(error));

            this.logger.error(
                `Error while fetching HR dashboard data: ${err.message}`,
                err.stack,
                HRService.name,
                { tenantId: normalizedTenantId, userId: user?.userId },
            );
            throw new InternalServerErrorException('Internal server error loading HR dashboard');
        }
    }

    private getCorpId(tenantConfig: TenantConfigTypes, user: UserSessionPayload): number | string {
        const sessionCorpId = Number(user?.providerCorpId || user?.providerGroupCorpId || 0);
        const configuredCorpId = tenantConfig.config?.corpId;
        return sessionCorpId > 0 ? sessionCorpId : configuredCorpId || 0;
    }
}