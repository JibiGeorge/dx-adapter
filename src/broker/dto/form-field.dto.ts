import { IsOptional } from 'class-validator';

export class GetFormFieldDto {
  @IsOptional()
  countryShortName?: string;

  @IsOptional()
  country2DigitCode?: string;

  @IsOptional()
  currency?: string;
}