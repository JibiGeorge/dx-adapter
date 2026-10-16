import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchClientDetailsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  corpId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  polId?: number;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class UpdateBeneficiaryDto {
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  lastName: string;

  @IsString()
  pihNumber: string;

  @IsString()
  relation: string;

  @IsOptional()
  @IsString()
  relationshipCode?: string;

  @IsOptional()
  @IsString()
  insurerNo?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  emailId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  altEmail?: string;

  @IsOptional()
  @IsString()
  altMobile?: string;

  @IsOptional()
  @IsString()
  passportNo?: string;

  @IsOptional()
  @IsString()
  dob?: string;

  @IsOptional()
  age?: string | number;

  @IsOptional()
  @IsString()
  sex?: string;

  @IsOptional()
  @IsString()
  maritalStatus?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  homeCountry?: string;

  @IsOptional()
  sumInsured?: string | number;

  @IsOptional()
  @IsString()
  areaCode?: string;

  @IsOptional()
  @IsString()
  inceptionDate?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}
