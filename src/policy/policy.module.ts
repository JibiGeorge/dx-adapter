import { Module } from '@nestjs/common';
import { PolicyController } from './policy.controller.js';
import { PolicyService } from './policy.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { BrokerModule } from '../broker/broker.module.js';
import { ClaimApiModule } from '../integrations/claim-api/claim-api.module.js';

@Module({
  imports: [AuthModule, TenantModule, BrokerModule, ClaimApiModule],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
