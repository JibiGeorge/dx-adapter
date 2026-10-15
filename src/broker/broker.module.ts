import { Module } from "@nestjs/common";
import { BrokerController } from "./broker.controller";
import { BrokerService } from "./broker.service";
import { AuthModule } from "../auth/auth.module";
import { ClaimApiModule } from "../integrations/claim-api/claim-api.module";
import { TenantModule } from "../tenant/tenant.module";
import { DatabaseModule } from "../database/database.module";
import { CountryApiModule } from "../integrations/country-api/country-api.module";
import { BankApiModule } from "../integrations/bank-api/bank-api.module";

@Module({
    imports: [AuthModule, ClaimApiModule, CountryApiModule, BankApiModule, TenantModule, DatabaseModule],
    controllers: [BrokerController],
    providers: [BrokerService],
    exports: [BrokerService],
})
export class BrokerModule { }