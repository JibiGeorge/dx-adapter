import { Module } from "@nestjs/common";
import { TenantController } from "./teanant.controller";
import { TenantService } from "./tenant.service";

@Module({
    controllers: [TenantController],
    providers: [TenantService]
})

export class TenantModule {}