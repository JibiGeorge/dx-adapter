import { Module } from '@nestjs/common';
import { BankApiService } from './bank-api.service';

@Module({
  providers: [BankApiService],
  exports: [BankApiService],
})
export class BankApiModule {}