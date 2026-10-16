import { BadRequestException, Body, Controller, Get, Headers, Query, UseGuards } from "@nestjs/common";
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
}