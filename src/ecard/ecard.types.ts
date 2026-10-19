export interface EcardMember {
  maid: string;
  name: string;
  firstName?: string;
  lastName?: string;
  emailId: string;
  staffId: string;
  pihNumber: string;
  relation: string;
  policyStatus: string;
  memberStatus: string;
  polNo: string;
  corpName: string;
  policyId?: number;
  insurerId?: number;
  priBenefId?: number;
  benefUserId?: number;
  isEcardAvailable?: boolean;
  isCoiAvailable?: boolean;
}

export interface EcardSearchResponse {
  isSuccess: boolean;
  total: number;
  members: EcardMember[];
  message?: string;
}

export interface EcardEntity {
  corpId: number;
  corpName: string;
}

export interface EcardPolicy {
  polId: number;
  polNo: string;
  polHolderName: string;
  inceptionDate?: string;
  expiryDate?: string;
  insuranceCompanyName?: string;
  insurerId?: number;
}
