import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { MemberService } from './member.service.js';

@Controller('member')
@UseGuards(JwtAuthGuard)
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get('policy')
  async getPolicy(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Res() res: Response,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'x-tenant-id header is required', policies: [] });
    }

    const result = await this.memberService.getPolicies(tenantId, user);
    const status = result.success ? 200 : 500;
    return res.status(status).json(result);
  }

  @Get('claims')
  async getClaims(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('host') hostHeader: string | undefined,
    @CurrentUser() user: UserSessionPayload,
    @Res() res: Response,
  ): Promise<any> {
    if (!tenantId?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: 'x-tenant-id header is required', claims: [] });
    }

    const result = await this.memberService.getClaims(tenantId, user, hostHeader);
    const status = result.success ? 200 : 500;
    return res.status(status).json(result);
  }
}
