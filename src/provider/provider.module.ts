import { Module } from '@nestjs/common';
import { ProviderController } from './provider.controller.js';
import { ProviderService } from './provider.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
