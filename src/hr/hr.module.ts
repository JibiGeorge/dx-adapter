import { Module } from "@nestjs/common";
import { HRController } from "./hr.controller.js";
import { HRService } from "./hr.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { ClaimApiModule } from "../integrations/claim-api/claim-api.module.js";
import { EcardApiModule } from "../integrations/ecard-api/ecard-api.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { BrokerModule } from "../broker/broker.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { DXApiModule } from "../integrations/dx-api/dx-api.module.js";
import { ProclaimApiModule } from "../integrations/proclaim-api/proclaim-api.module.js";

@Module({
  imports: [AuthModule, ClaimApiModule, EcardApiModule, TenantModule, BrokerModule, DatabaseModule, DXApiModule, ProclaimApiModule],
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule { }
