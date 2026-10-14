export interface AgentPolicySearchResponse {
  isSuccess: boolean;
  message?: string;
  policyHeaders?: PolicyHeaderItem[];
  PolicyHeaders?: PolicyHeaderItem[];
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
  [key: string]: unknown;
}

export interface PolicyDetailItem {
  pol_CorporateId?: number;
  CorporateId?: number;
  corporateId?: number;
  [key: string]: unknown;
}
