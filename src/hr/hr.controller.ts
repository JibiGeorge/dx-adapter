import { BadRequestException, Body, Controller, Get, Headers, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { HRRoleGuard } from "../../common/guards/hr-role.guard.js";
import { HRService } from "./hr.service.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { UserSessionPayload } from "../auth/auth.types.js";
import { HRDashboardResponse, HRStatusResponse } from "./hr.types.js";
import { GetCorpDto } from "./dto/corp.dto.js";

@Controller('hr')
@UseGuards(JwtAuthGuard, HRRoleGuard)
export class HRController {
    constructor(private readonly hrService: HRService) { }

    @Get('index')
    async getHRData(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload
    ): Promise<HRDashboardResponse> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        return this.hrService.getHRData(tenantId, user);
    }

    @Get('stats')
    async getHRStatus(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Headers('x-role') roleHeader?: string,
        @Headers('role') altRoleHeader?: string,
    ): Promise<HRStatusResponse> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        const requestedRole = (roleHeader || altRoleHeader || 'hr').trim();
        return this.hrService.getHRStatus(tenantId, user, requestedRole);
    }

    @Get('policies')
    async getPolicies(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }
        return this.hrService.getPolicies(tenantId, user);
    }

    @Get('policies-by-corp')
    async getPoliciesByCorp(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Query() queryDto?: GetCorpDto,
        @Body() bodyDto?: GetCorpDto,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }
        const effectiveDto = queryDto?.corpId ? queryDto : bodyDto;
        return this.hrService.getPoliciesByCorp(tenantId, user, effectiveDto);
    }

    @Get('policy-details-mwc')
    async getPolicyDetailsMWC(
        @Headers('host') host: string,
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Headers('x-role') roleHeader?: string,
        @Headers('role') altRoleHeader?: string,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }
        const requestedRole = (roleHeader || altRoleHeader || 'hr').trim();
        return this.hrService.getPolicyDetailsMWC(tenantId, user, requestedRole, host);
    }

    @Get('plan-types')
    async getPlanTypes(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Query('policyNo') policyNo?: string,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        if (!policyNo) {
            throw new BadRequestException('Policy number is required');
        }

        return this.hrService.getPlanTypes(policyNo, tenantId);
    }

    @Get('/policies/:policyNo/beneficiaries')
    async getBeneficiariesForPolicy(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Headers('host') host: string,
        @Param('policyNo') policyNo: string,
        @Query('polId') polId?: string,
        @Query('corpIdOverride') corpIdOverride?: string,
        @Query('startIndex') startIndex?: string,
        @Query('range') range?: string,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        if (!policyNo) {
            throw new BadRequestException('Policy number is required');
        }

        return this.hrService.getPolicyBeneficiaries({
            policyNo,
            user,
            polId: polId ? Number(polId) : 0,
            corpIdOverride: corpIdOverride
                ? Number(corpIdOverride)
                : 0,
            startIndex: startIndex ? Number(startIndex) : 0,
            range: range ? Number(range) : 100,
            tenantId: tenantId,
            host: host
        });
    }

    @Get('beneficiaries-search')
    async getBeneficiariesSearch(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Headers('host') host: string,
        @Query() query: {
            empCode?: string;
            corpIdOverride?: string;
            polId?: string;
            benefName?: string;
            benefEmail?: string;
            policyPlan?: string;
            pihNumber?: string;
            maid?: string;
        },
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        return this.hrService.beneficiariesSearch(tenantId, user, host, query);
    }

    @Get('client-detail')
    async getClientDetails(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Query() query: {
            maid: string;
            empCode?: string;
            polId: string;
            memberPolId?: string;
        },
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        return this.hrService.getClientDetails(tenantId, user, query);
    }

    @Get('beneficiary-detail/:maid')
    async getBeneficiaryDetail(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload,
        @Param('maid') maid: string,
    ): Promise<any> {
        if (!tenantId?.trim()) {
            throw new BadRequestException('x-tenant-id header is required');
        }

        if (!maid?.trim()) {
            throw new BadRequestException('maid parameter is required');
        }

        return this.hrService.getBeneficiaryDetail(tenantId, user, maid);
    }
}