import { Module } from '@nestjs/common';
import { EcardApiService } from './ecard-api.service.js';

@Module({
  providers: [EcardApiService],
  exports: [EcardApiService],
})
export class EcardApiModule {}
