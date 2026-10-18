import { Module } from '@nestjs/common';
import { DXApiService } from './dx-api.service.js';

@Module({
  providers: [DXApiService],
  exports: [DXApiService],
})
export class DXApiModule { }