import { IsOptional, IsString } from 'class-validator';

export class EnrollmentStatusQueryDto {
  @IsOptional()
  @IsString()
  corpId?: string;

  @IsOptional()
  @IsString()
  polId?: string;

  @IsOptional()
  @IsString()
  policyNo?: string;

  @IsOptional()
  @IsString()
  refFile?: string;

  @IsOptional()
  @IsString()
  insuranceId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  productType?: string;

  @IsOptional()
  @IsString()
  operation?: string;

  @IsOptional()
  @IsString()
  approval?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
