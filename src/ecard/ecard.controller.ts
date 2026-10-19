import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { EcardService } from './ecard.service.js';
import {
  DownloadCoverageDto,
  DownloadEcardDto,
  SearchEcardDto,
} from './dto/ecard.dto.js';

@Controller('ecard')
@UseGuards(JwtAuthGuard)
export class EcardController {
  constructor(private readonly ecardService: EcardService) {}

  @Get('entities')
  async getEntities(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.ecardService.getEntities(tenantId, user);
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
    return this.ecardService.getPolicies(
      tenantId,
      user,
      corpId ? Number(corpId) : undefined,
    );
  }

  @Post('search')
  async search(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: SearchEcardDto,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.ecardService.search(tenantId, user, dto);
  }

  @Post('download')
  async downloadEcard(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: DownloadEcardDto,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.ecardService.downloadEcard(tenantId, user, dto);
  }

  @Post('coverage')
  async downloadCoverage(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: DownloadCoverageDto,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.ecardService.downloadCoverage(tenantId, user, dto);
  }
}
