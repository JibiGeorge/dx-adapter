import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class HospitalSearchDto {
    @IsOptional()
    @IsString()
    InsuranceCompany?: string;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    Latitude?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    Longitude?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    Distance?: number;

    @IsOptional()
    @IsString()
    HospSpeciality?: string;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    MARating?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    corporateId?: number;
}
