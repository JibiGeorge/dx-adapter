import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchEcardDto {
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
  benefName?: string;

  @IsOptional()
  @IsString()
  empCode?: string;

  @IsOptional()
  @IsString()
  docType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}

export class DownloadEcardDto {
  @IsString()
  maid: string;

  @Type(() => Number)
  @IsNumber()
  polid: number;

  @IsOptional()
  insurerid?: string | number;

  @IsOptional()
  polSubtype?: number;

  @IsOptional()
  @IsString()
  printPattern?: string;
}

export class DownloadCoverageDto {
  @IsOptional()
  benefPriId?: string | number;

  @IsOptional()
  benefUserId?: string | number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  polid?: number;

  @IsOptional()
  insurerId?: string | number;

  @IsOptional()
  maid?: string | number;

  @IsOptional()
  corporateId?: string | number;
}
