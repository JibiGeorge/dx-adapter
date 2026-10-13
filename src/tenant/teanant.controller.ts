import { Controller, Get, Param } from "@nestjs/common";
import { TenantService } from "./tenant.service";

@Controller('tenant')
export class TenantController {
    constructor(private readonly tenantService: TenantService) {}
    @Get(':id/config')
    getTenantConfig(@Param('id') id: string) {
        return this.tenantService.getTenantconfigById(id)
    }
}