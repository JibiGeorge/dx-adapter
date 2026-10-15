import { Module } from '@nestjs/common';
import { CountryApiService } from './country-api.service';

@Module({
  providers: [CountryApiService],
  exports: [CountryApiService],
})
export class CountryApiModule {}