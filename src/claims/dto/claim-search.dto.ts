import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimSearchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  corpId?: number;

  @IsOptional()
  @IsString()
  corpName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  polId?: number;

  @IsOptional()
  @IsString()
  polNo?: string;

  @IsOptional()
  @IsString()
  empCode?: string;

  @IsOptional()
  @IsString()
  empName?: string;

  @IsOptional()
  @IsString()
  claimNo?: string;

  @IsOptional()
  @IsString()
  claimType?: 'Active' | 'Past';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  statusId?: number;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
