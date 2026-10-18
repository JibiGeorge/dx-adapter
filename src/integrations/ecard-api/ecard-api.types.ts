export interface EcardPrintRequest {
  executionMode: string;
  identifierType: string;
  printPattern: string;
  identifierValue: string;
}

export interface EcardPdfRequest {
  printRequest: EcardPrintRequest;
  printPattern: string;
  policyId: number;
  insurerId: number;
  corporateId: number;
  policySubId: number;
  outputType: string;
  dbType: string;
  isPasswordEnabled: boolean;
  printExpiredPolicy: boolean;
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
