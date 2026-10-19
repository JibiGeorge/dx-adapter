export interface NormalizedClaim {
  claimId: string;
  claimReferenceNo: string;
  actualClaimId: number;
  firstName?: string;
  lastName?: string;
  beneficiaryName: string;
  employeeId?: string;
  policyNumber: string;
  claimType: string;
  treatmentDate: string;
  dateOfDischarge?: string;
  claimedAmount: number;
  approvedAmount: number;
  currency: string;
  status: string;
  isPastClaim: boolean;
}

export interface ClaimAuditItem {
  status: string;
  date: string;
}

export interface NormalizedClaimDetails {
  claimReferenceNo: string;
  claimNumber: string;
  beneficiaryName: string;
  policyNumber: string;
  claimType: string;
  dateOfAdmission: string;
  dateOfDischarge: string;
  claimedAmount: number;
  payableAmount: number;
  currency: string;
  currentStatus: string;
  auditTrail: ClaimAuditItem[];
}
