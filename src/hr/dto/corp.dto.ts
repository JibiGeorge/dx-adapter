import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class GetCorpDto {
    @IsOptional()
    @Transform(({ value }) => (value !== undefined && value !== null ? String(value).trim() : value))
    @IsString()
    corpId?: string;
}