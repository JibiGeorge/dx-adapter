import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchEcardDetailsDto {
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    corpId?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    polId?: number;

    @IsOptional()
    @IsString()
    benefName?: string;

    @IsOptional()
    @IsString()
    docType?: string;
}

export class ViewEcardDto {
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    corpId?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    polId?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    policyId?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    memberPolicyId?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    maid?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    insurerId?: number;

    @IsOptional()
    @IsString()
    printPattern?: string;
}

