import { Controller, Get, Headers, Param } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
    constructor(private readonly tenantService: TenantService) { }

    @Get('config')
    getTenantConfig(@Headers('x-tenant-id') id: string) {
        return this.tenantService.getTenantconfigById(id);
    }
}
