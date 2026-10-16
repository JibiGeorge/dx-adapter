export interface AgentPolicySearchResponse {
  isSuccess: boolean;
  message?: string;
  policyHeaders?: PolicyHeaderItem[];
  PolicyHeaders?: PolicyHeaderItem[];
  policyDetails?: PolicyDetailItem[];
  PolicyDetails?: PolicyDetailItem[];
  [key: string]: unknown;
}

export interface PolicyHeaderItem {
  CorporateId?: number;
  corporateId?: number;
  PolicyHolderName?: string;
  policyHolderName?: string;
  [key: string]: unknown;
}

export interface GroupCorpPolicyResponse {
  policyDetails?: PolicyDetailItem[];
  PolicyDetails?: PolicyDetailItem[];
  [key: string]: unknown;
}

export interface PolicyDetailItem {
  pol_CorporateId?: number;
  CorporateId?: number;
  corporateId?: number;
  polHolderName?: string;
  PolHolderName?: string;
  policyHolderName?: string;
  PolicyHolderName?: string;
  polEndDate?: string;
  PolEndDate?: string;
  endDate?: string;
  EndDate?: string;
  [key: string]: unknown;
}
