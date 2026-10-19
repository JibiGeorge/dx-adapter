export interface PolicyItem {
  policyId: number;
  policyNumber: string;
  planName: string;
  planType?: string;
  policyHolderName: string;
  startDate: string;
  endDate: string;
  startDateMs?: number;
  endDateMs?: number;
  status: 'Active' | 'Expired' | 'Future';
  corporateId?: number;
  corporateName?: string;
  livesCount?: number;
  dbType?: string;
}

export interface BeneficiaryItem {
  maid?: number;
  firstName: string;
  lastName: string;
  empId: string;
  relation: string;
  gender?: string;
  memberStatus?: string;
  policyNumber?: string;
  policyId?: number;
}

export interface PolicyDocumentItem {
  documentId?: string | number;
  fileName: string;
  downloadUrl: string;
  documentType: 'claim_form' | 'network_hospital' | 'policy_attachment';
  isExternal?: boolean;
}

export interface PolicyLivesBatchRequestItem {
  policyId: number;
  startDateMs?: number;
}

export interface PolicyLivesBatchResultItem {
  policyId: number;
  count: number;
}

export interface PolicyListResponse {
  success: boolean;
  totalCount: number;
  activeCount: number;
  policies: PolicyItem[];
  kpis?: {
    totalPolicies: number;
    activePolicies: number;
    totalLives: number;
    expiringSoonCount: number;
  };
}

export interface PolicyBeneficiariesResponse {
  success: boolean;
  count: number;
  totalCount: number;
  beneficiaries: BeneficiaryItem[];
}

export interface PolicyDocumentsResponse {
  success: boolean;
  documents: PolicyDocumentItem[];
}
