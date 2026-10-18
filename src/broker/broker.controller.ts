import { All, BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { BrokerRoleGuard } from '../../common/guards/broker-role.guard.js';
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
  SaveBankDetailsResponse,
  UploadClaimDocumentResponse,
} from './broker.types.js';
import type { UploadedMulterFile } from './broker.types.js';
import { GetFormFieldDto } from './dto/form-field.dto.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubmitClaimDto } from './dto/submit-claim.dto.js';

@Controller('broker')
@UseGuards(JwtAuthGuard, BrokerRoleGuard)
export class BrokerController {
  constructor(private readonly brokerService: BrokerService) { }

  @Get('index')
  async getBrokerData(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Headers('host') host: string,
  ): Promise<DashboardResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getBrokerData(tenantId, user, host);
  }

  @Get('policy-list')
  async getPolicyList(
    @Headers('host') host: string,
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.getPolicyList(tenantId, user, host);
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

  @Post('bank-form-fields')
  async getBankformField(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: GetFormFieldDto
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException("x-tenant-id header is required");
    }

    return this.brokerService.getBankformField(tenantId, user, dto);
  }

  @Post('save-bank-details')
  async saveBankDetails(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: any,
  ): Promise<SaveBankDetailsResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.saveBankDetails(tenantId, user, dto);
  }

  @Post('upload-claim-document')
  @UseInterceptors(FileInterceptor('file'))
  async uploadClaimDocument(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @UploadedFile() file?: UploadedMulterFile,
  ): Promise<UploadClaimDocumentResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.brokerService.uploadClaimDocument(tenantId, user, file);
  }

  @Get('search-diagnosis')
  async searchDiagnosis(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Query('term') term?: string,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.searchDiagnosis(tenantId, user, term);
  }

  @Post('submit-claim')
  async submitClaim(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: SubmitClaimDto,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    return this.brokerService.submitClaim(tenantId, user, dto);
  }
}