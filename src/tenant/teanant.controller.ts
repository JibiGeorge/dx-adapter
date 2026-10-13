import { Controller, Get, Param } from "@nestjs/common";

@Controller('tenant')
export class TenantController {
    @Get(':id/config')
    getTenantConfig(@Param('id') id: string) {
        return {}
    }
}