import { All, BadRequestException, Controller, Get, Headers, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { BrokerService } from './broker.service.js';
import type { Request as ExpressRequest } from 'express';
import {
  BankAccountItem,
  BankAccountsResponse,
  Beneficiaries,
  ClaimDateResponse,
  CountryResponse,
  DashboardResponse,
} from './broker.types.js';

@Controller('broker')
@UseGuards(JwtAuthGuard)
export class BrokerController {
  constructor(private readonly brokerService: BrokerService) { }

  @Get('index')
  async getBrokerData(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<DashboardResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getBrokerData(tenantId, user);
  }

  @Get('policy-list')
  async getPolicyList(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getPolicyList(tenantId, user);
  }

  @Get('member-claim-data')
  async getMemberClaimData(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Query('maid') maid?: string,
    @Query('polId') polId?: string,
    @Query('empCode') empCode?: string,
    @Query('corpId') corpId?: string,
    @Query('pihNumber') pihNumber?: string,
    @Query('name') name?: string,
  ): Promise<ClaimDateResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getMemberClaimData(tenantId, user, maid, polId, empCode, corpId, pihNumber, name);
  }

  @Get('countries')
  async getCountries(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<CountryResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getCountries(tenantId, user);
  }

  @Get('claim-categories')
  async getClaimCategories(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    const categories = [
      { id: 'Illness', name: 'Illness' },
      { id: 'Accident', name: 'Accident' },
    ];

    return {
      isSuccess: true,
      categories,
    };
  }

  @All(['bank-accounts', 'bank-accounts/:entityId'])
  async getBankAccounts(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Req() req: ExpressRequest,
    @Param('entityId') paramEntityId?: string,
  ): Promise<BankAccountsResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getBankAccounts(tenantId, user, req, paramEntityId);
  }
}