import { Module } from '@nestjs/common';
import { MemberController } from './member.controller.js';
import { MemberService } from './member.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ClaimApiModule } from '../integrations/claim-api/claim-api.module.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [AuthModule, TenantModule, ClaimApiModule, DatabaseModule],
  controllers: [MemberController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
