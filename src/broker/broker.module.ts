import { Module } from "@nestjs/common";
import { BrokerController } from "./broker.controller";
import { BrokerService } from "./broker.service";
import { AuthModule } from "../auth/auth.module";
import { ClaimApiModule } from "../integrations/claim-api/claim-api.module";
import { TenantModule } from "../tenant/tenant.module";

@Module({
    imports: [AuthModule, ClaimApiModule, TenantModule],
    controllers: [BrokerController],
    providers: [BrokerService],
    exports: [BrokerService],
})
export class BrokerModule { }