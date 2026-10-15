import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimBillDto {
  @IsOptional()
  @IsString()
  billNo?: string;

  @IsOptional()
  @IsString()
  billDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  billType?: string;

  @IsOptional()
  @IsString()
  doctorName?: string;

  @IsOptional()
  @IsString()
  clinicAddress?: string;
}

export class ClaimDocumentDto {
  @IsOptional()
  @IsString()
  mainPath?: string;

  @IsOptional()
  @IsString()
  azurePath?: string;

  @IsOptional()
  @IsString()
  fileGUID?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class SubmitClaimDto {
  @IsOptional()
  @IsString()
  claimRegnNo?: string;

  @IsOptional()
  @IsString()
  ClaimCategory?: string;

  @IsOptional()
  @IsString()
  claimCategory?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  MAID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  polID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  PolID?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  benefId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  BenefId?: number;

  @IsOptional()
  @IsString()
  employeeID?: string;

  @IsOptional()
  @IsString()
  EmployeeID?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  providerCorpid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ProviderCorpid?: number;

  @IsOptional()
  @IsString()
  dateofAdmission?: string;

  @IsOptional()
  @IsString()
  DateofAdmission?: string;

  @IsOptional()
  @IsString()
  dateofDischarge?: string;

  @IsOptional()
  @IsString()
  DateofDischarge?: string;

  @IsOptional()
  @IsString()
  dateOfIncidence?: string;

  @IsOptional()
  @IsString()
  DateOfIncidence?: string;

  @IsOptional()
  @IsString()
  symptomDate?: string;

  @IsOptional()
  @IsString()
  SymptomDate?: string;

  @IsOptional()
  @IsString()
  ailment?: string;

  @IsOptional()
  @IsString()
  Ailment?: string;

  @IsOptional()
  @IsString()
  icdCode?: string;

  @IsOptional()
  @IsString()
  ICDCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalBillAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  TotalBillAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  hospAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  HospAmount?: number;

  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @IsOptional()
  @IsBoolean()
  IsDraft?: boolean;

  @IsOptional()
  @IsBoolean()
  isDomi?: boolean;

  @IsOptional()
  @IsBoolean()
  IsDomi?: boolean;

  @IsOptional()
  @IsString()
  claimType?: string;

  @IsOptional()
  @IsString()
  ClaimType?: string;

  @IsOptional()
  @IsString()
  countryOfIncidence?: string;

  @IsOptional()
  @IsString()
  CountryOfIncidence?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  Currency?: string;

  @IsOptional()
  @IsString()
  symptom?: string;

  @IsOptional()
  @IsString()
  Symptom?: string;

  @IsOptional()
  @IsString()
  accountReferenceId?: string;

  @IsOptional()
  @IsString()
  AccountReferenceId?: string;

  @IsOptional()
  @IsString()
  selectedBenefName?: string;

  @IsOptional()
  @IsString()
  SelectedBenefName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimBillDto)
  bills?: ClaimBillDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimBillDto)
  Bills?: ClaimBillDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimDocumentDto)
  documents?: ClaimDocumentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimDocumentDto)
  Documents?: ClaimDocumentDto[];

  @IsOptional()
  @IsString()
  claimDataJson?: string;
}