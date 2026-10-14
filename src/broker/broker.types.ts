export interface DashboardResponse {
  success: boolean;
  userName: string;
  brokerName: string;
  brokerId: string | number;
  isAdminBroker: boolean;
  isLawton: boolean;
  corpId: number;
  corpIds: number[];
  welcomeBrandingName: string;
  roleAccess: BrokerRoleAccess;
  reportsConfig: ReportsConfig;
}

export interface BrokerRoleAccess {
  showClaims: boolean;
  showSearchHospital: boolean;
  showPolicyDetails: boolean;
  showMemberEnrollment: boolean;
  showEcard: boolean;
  showProfile: boolean;
  showMAestroDashboard: boolean;
  showClaimSubmission: boolean;
  showPolicyList: boolean;
  showUserManagement: boolean;
  maestroDashboards: MaestroDashboardAccess;
}

export interface MaestroDashboardAccess {
  showWebMISReport: boolean;
  showPADashboard: boolean;
}

export interface ReportsConfig {
  corpId: number;
  brokerId: number;
  departmentId: string;
  dashboards: BrokerDashboardOption[];
}

export interface BrokerDashboardOption {
  key: string;
  label: string;
  includeDepartmentFilter: boolean;
  filterTable: string;
  filterColumn: string;
  filterOn: string;
}