import { Module } from '@nestjs/common';
import { TenantController } from './teanant.controller';
import { TenantService } from './tenant.service';
import { AppCacheModule } from '../cache/cache.module';

@Module({
    imports: [AppCacheModule],
    controllers: [TenantController],
    providers: [TenantService],
    exports: [TenantService],
})
export class TenantModule {}

