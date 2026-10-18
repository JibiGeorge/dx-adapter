export interface EcardPrintRequest {
  executionMode: string;
  identifierType: string;
  printPattern: string;
  identifierValue: string;
}

export interface EcardPdfRequest {
  printRequest: EcardPrintRequest;
  isPasswordEnabled: boolean;
  printExpiredPolicy: boolean;
  policyId: number;
  insurerId: number | string;
  dbType: string;
  outputType: string;
  corporateId?: number;
  policySubId?: number;
  printPattern?: string;
}

export interface CoverageLetterRequest {
  PribenefId: number;
  BenefId: number;
  MemberPolicyId: number;
  MasterPolicyId?: number;
  InsurerId: number;
  DbType: string;
  OutputType: string;
  CorporateId: number;
  AppId: string;
  PrintPattern?: string;
  MemberId?: number;
}
