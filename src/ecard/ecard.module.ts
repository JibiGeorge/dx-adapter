import { Module } from '@nestjs/common';
import { EcardController } from './ecard.controller.js';
import { EcardService } from './ecard.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { BrokerModule } from '../broker/broker.module.js';

@Module({
  imports: [AuthModule, TenantModule, BrokerModule],
  controllers: [EcardController],
  providers: [EcardService],
  exports: [EcardService],
})
export class EcardModule {}
