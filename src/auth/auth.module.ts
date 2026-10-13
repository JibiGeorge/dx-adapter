import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
    imports: [TenantModule],
    controllers: [AuthController],
    providers: [AuthService],
})
export class AuthModule {}
