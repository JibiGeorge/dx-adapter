import { Controller, Get, Headers, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ThemeService } from './theme.service.js';

@Controller(['theme', 'api/theme'])
export class ThemeController {
  constructor(private readonly themeService: ThemeService) {}

  @Get()
  async getTheme(
    @Query('tenantId') tenantIdQuery: string,
    @Headers('x-tenant-id') tenantIdHeader: string,
    @Query('corpId') corpIdQuery: string,
    @Query('host') hostQuery: string,
    @Headers('host') hostHeader: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean; theme: any }> {
    const tenantId = tenantIdQuery || tenantIdHeader || '';
    const host = hostQuery || hostHeader || req.hostname || '';
    return this.themeService.getTheme(tenantId, corpIdQuery, host);
  }
}
