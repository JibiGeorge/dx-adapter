import { Module } from '@nestjs/common';
import { ClaimApiService } from './claim-api.service';

@Module({
  providers: [ClaimApiService],
  exports: [ClaimApiService],
})
export class ClaimApiModule {}