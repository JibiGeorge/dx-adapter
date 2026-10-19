import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { PolicyService } from './policy.service.js';
import type {
  PolicyLivesBatchRequestItem,
} from './policy.types.js';

@Controller('policy')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get('list')
  async getPolicyList(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-role') role: string,
    @CurrentUser() user: UserSessionPayload,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.policyService.getPolicyList(tenantId, user, role);
  }

  @Get(':policyId/beneficiaries')
  async getBeneficiaries(
    @Headers('x-tenant-id') tenantId: string,
    @Param('policyId') policyId: string,
    @Query('polNo') polNo?: string,
    @Query('corpId') corpId?: string,
    @Query('startIndex') startIndex?: string,
    @Query('range') range?: string,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.policyService.getBeneficiariesForPolicy(
      tenantId,
      polNo || '',
      policyId ? Number(policyId) : undefined,
      corpId ? Number(corpId) : undefined,
      startIndex ? Number(startIndex) : 0,
      range ? Number(range) : 100,
    );
  }

  @Get(':policyId/documents')
  async getDocuments(
    @Headers('x-tenant-id') tenantId: string,
    @Param('policyId') policyId: string,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.policyService.getPolicyDocuments(
      tenantId,
      Number(policyId) || 0,
    );
  }

  @Post('lives-batch')
  async getLivesBatch(
    @Headers('x-tenant-id') tenantId: string,
    @Body() body: { requests: PolicyLivesBatchRequestItem[] },
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.policyService.getPolicyLivesCountBatch(
      tenantId,
      body?.requests || [],
    );
  }
}
