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
import { ProviderService } from './provider.service.js';
import type { ProviderSearchDto } from './provider.types.js';

@Controller('provider')
@UseGuards(JwtAuthGuard)
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  @Post('search')
  async search(
    @Headers('x-tenant-id') tenantId: string,
    @Body() dto: ProviderSearchDto,
  ) {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return this.providerService.searchProviders(tenantId, dto);
  }

  @Get('geocode')
  async geocode(@Query('q') q: string, @Query('lang') lang?: string) {
    if (!q?.trim()) {
      return [];
    }
    return this.providerService.geocodeLocation(q, lang || 'en');
  }
}
