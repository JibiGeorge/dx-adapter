import { Module } from '@nestjs/common';
import { ProclaimApiService } from './proclaim-api.service';

@Module({
  providers: [ProclaimApiService],
  exports: [ProclaimApiService],
})
export class ProclaimApiModule {}
