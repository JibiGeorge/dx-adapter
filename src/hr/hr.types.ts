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
