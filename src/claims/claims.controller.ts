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
import { ClaimsService } from './claims.service.js';
import { ClaimSearchDto } from './dto/claim-search.dto.js';

@Controller('claims')
@UseGuards(JwtAuthGuard)
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Get('entities')
  async getEntities(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.claimsService.getEntities(tenantId, user);
  }

  @Get('policies')
  async getPolicies(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Query('corpId') corpId?: string,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.claimsService.getPolicies(
      tenantId,
      user,
      corpId ? Number(corpId) : undefined,
    );
  }

  @Post('search')
  async searchClaims(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: ClaimSearchDto,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.claimsService.searchClaims(tenantId, user, dto);
  }

  @Get('details/:claimReferenceNo')
  async getClaimDetails(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Param('claimReferenceNo') claimReferenceNo: string,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    if (!claimReferenceNo?.trim()) {
      throw new BadRequestException('claimReferenceNo is required');
    }
    return this.claimsService.getClaimDetails(tenantId, user, claimReferenceNo.trim());
  }
}
