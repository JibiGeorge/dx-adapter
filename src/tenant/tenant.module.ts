import { Module } from '@nestjs/common';
import { TenantController } from './teanant.controller';
import { TenantService } from './tenant.service';
import { AppCacheModule } from '../cache/cache.module';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [AppCacheModule, DatabaseModule],
    controllers: [TenantController],
    providers: [TenantService],
    exports: [TenantService],
})
export class TenantModule {}


