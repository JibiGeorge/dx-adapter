import { Module } from "@nestjs/common";
import { HRController } from "./hr.controller.js";
import { HRService } from "./hr.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { ClaimApiModule } from "../integrations/claim-api/claim-api.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BrokerModule } from "../broker/broker.module.js";

@Module({
  imports: [AuthModule, ClaimApiModule, TenantModule, BrokerModule],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}
