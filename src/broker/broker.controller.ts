import { Controller, Get, Headers, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { UserSessionPayload } from "../auth/auth.types.js";
import { BrokerService } from "./broker.service.js";

@Controller('broker')
@UseGuards(JwtAuthGuard)
export class BrokerController {
    constructor(
        private readonly brokerService: BrokerService
    ) { }

    @Get('index')
    getBrokerData(
        @Headers('x-tenant-id') tenantId: string,
        @CurrentUser() user: UserSessionPayload
    ) {
        return this.brokerService.getBrokerData(tenantId, user);
    }
}