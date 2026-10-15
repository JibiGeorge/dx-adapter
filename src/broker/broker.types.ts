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

export interface ClaimDateResponse {
  isSuccess: boolean;
  error?: string;
  benbeneficiaries?: Beneficiaries[];
  empCode?: string;
  providerCorpId?: number;
  polId?: number
}

export interface Beneficiaries {
  MAID: string | number;
  BenefUserId: string | number;
  Name: string;
  Relation: string;
  Gender: string;
  DOB: string;
  PIHMemberId: string;
}

export interface CountryMasterItem {
  countryId: number;
  countryName: string;
  countryCode?: string;
  currencyName?: string;
  currencyCode?: string;
  countryContactCode?: string;
  regionid?: number;
  isActive?: number;
  createdDate?: string;
  createdBy?: number;
  countryCode2Digit?: string;
  [key: string]: unknown;
}

export interface CountryResponse {
  countryMasters: CountryMasterItem[];
}
