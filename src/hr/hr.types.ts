export interface HRDashboardResponse {
  success: boolean;
  userName: string;
  corporateName: string;
  corpId: number | string;
  welcomeBrandingName: string;
  customHRPage: string;
  isCorpHR: boolean;
  isLawton: boolean;
  roleAccess: HRRoleAccess;
  hasSubCorporates: boolean;
  reportsConfig?: HRReportsConfig;
}

export interface HRRoleAccess {
  showMAestroDashboard: boolean;
  showEcard: boolean;
  showSearchHospital: boolean;
  showMemberEnrollment: boolean;
  showTrackClaim: boolean;
  showPolicyDetails: boolean;
  showProfile: boolean;
  maestroDashboards: {
    showPADashboard: boolean;
    showWebMISReport: boolean;
  };
}

export interface HRReportsConfig {
  corpId: number | string;
  dashboards: any[];
}

export interface HRStatusResponse {
  success: boolean;
  stats: HRStats;
}

export interface HRStats {
  corporateName: string;
  totalEmployees: number;
  activeEnrolledMembers: number;
  pendingEnrollments: number;
  totalClaimsRaised: number;
  pendingClaimsApproval: number;
  recentClaims: HRRecentClaim[];
}

export interface HRRecentClaim {
  id: string | number;
  employeeName: string;
  claimAmount: number;
  status: string;
}
export interface SubCorpItem {
  Value: string;
  Text: string;
  value: string;
  text: string;
  corpId: number;
  corpName: string;
}

export interface UploadedMulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

