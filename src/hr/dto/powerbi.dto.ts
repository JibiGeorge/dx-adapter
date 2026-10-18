import { IsNotEmpty, IsString } from 'class-validator';

export class PowerBIDto {
  @IsNotEmpty()
  @IsString()
  dashboardType: string;
}
