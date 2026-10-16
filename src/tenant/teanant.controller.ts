import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
    constructor(private readonly tenantService: TenantService) { }

    @Get('config')
    getTenantConfig(@Headers('x-tenant-id') id: string) {
        return this.tenantService.getTenantconfigById(id);
    }

    @Get('components')
    getTenantComponents(
        @Headers('x-tenant-id') tenantId: string,
        @Headers('x-role') roleHeader: string,
        @Headers('role') altRoleHeader: string,
        @Query('portalKey') portalKey?: string,
        @Query('tenantId') altTenantId?: string,
        @Query('role') altRole?: string,
    ) {
        const effectiveTenantId = tenantId || altTenantId;
        const effectiveRole = roleHeader || altRoleHeader || altRole;
        return this.tenantService.getComponents(effectiveTenantId, portalKey, effectiveRole);
    }
}
