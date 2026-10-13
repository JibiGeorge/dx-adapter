// ─── External Authentication API ────────────────────────────────────────────

export interface AuthAccessToken {
  access_token: string;
  token_type: string;
  expiresin: number;
  issued: string;
  expires: string;
  applicationid: number;
}

export interface AuthRole {
  roleId: number;
  roleName: string;
}

export interface AuthFeature {
  featureId: number;
  featureName: string;
}

export interface AuthSuccessResponse {
  username: string;
  userId: number;
  applicationId: string;
  emailId?: string;
  mobile?: string;
  maid?: number;
  MAID?: number;
  authenticated: boolean;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  accessToken: AuthAccessToken;
  roles: AuthRole[];
  features: AuthFeature[];
  isFirstLogin: boolean;
  isSuccess: true;
}

export interface AuthFailureResponse {
  userId: number;
  authenticated: false;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  isFirstLogin: boolean;
  isSuccess: false;
  errorMessage: string;
  errorDescription: string;
}

export type AuthPublicResponse =
  | AuthSuccessResponse
  | AuthFailureResponse;

export type AuthResponse = AuthPublicResponse;

// ─── External Login Request ─────────────────────────────────────────────────

export interface ExternalLoginRequest {
  grant_type: string;
  username: string;
  password: string;
  applicationId: string;
  accesstoken: string;
  userAgent: string;
  emailId: string;
}

// ─── External User Profile ──────────────────────────────────────────────────

export interface ExternalBaseProfile {
  FirstName?: string;
  firstName?: string;
  UserName?: string;
  userName?: string;
  EmailId?: string;
  emailId?: string;
  MobileNo?: string;
  mobileNo?: string;
  Maid?: number | string;
  maid?: number | string;
  EmployeeId?: string;
  employeeId?: string;
  EntityId?: number | string;
  entityId?: number | string;
  Address?: string;
  address?: string;
  AltMobileNo?: string;
  altMobileNo?: string;
  AltMobile?: string;
  altMobile?: string;
  AltEmailId?: string;
  altEmailId?: string;
  ProfileImgUrl?: string;
  profileImgUrl?: string;
  ProfileImages?: ExternalProfileImage[];
  profileImages?: ExternalProfileImage[];
  UserAddresses?: ExternalUserAddress[];
  userAddresses?: ExternalUserAddress[];
  [key: string]: unknown;
}

export interface ExternalProfileImage {
  ImageTag?: string;
  imageTag?: string;
  ImagePath?: string;
  imagePath?: string;
}

export interface ExternalUserAddress {
  AddressLine1?: string;
  addressLine1?: string;
}

export interface ExternalRole {
  RoleName?: string;
  roleName?: string;
}

export interface ExternalRolesFeatures {
  Roles?: ExternalRole[];
  roles?: ExternalRole[];
  Features?: unknown[];
  features?: unknown[];
}

export interface ExternalUserProfile {
  UserId?: number | string;
  userId?: number | string;
  BaseProfileData?: ExternalBaseProfile;
  baseProfileData?: ExternalBaseProfile;
  baseProfile?: ExternalBaseProfile & {
    BaseProfileData?: ExternalBaseProfile;
  };
  RolesFeatures?: ExternalRolesFeatures;
  rolesFeatures?: ExternalRolesFeatures;
  PropertyData?: Record<string, unknown>;
  propertyData?: Record<string, unknown>;
  UserAddresses?: ExternalUserAddress[];
  userAddresses?: ExternalUserAddress[];
  [key: string]: unknown;
}

// ─── Profile Overrides ──────────────────────────────────────────────────────

export interface ProfileOverrides {
  address?: string;
  mobile?: string;
  altMobile?: string;
  altEmailId?: string;
  profileImgUrl?: string;
}

// ─── Application Session ────────────────────────────────────────────────────

export interface UserSessionRoles {
  isAgent: boolean;
  isScheme: boolean;
  isCorpHR: boolean;
  isInsurer: boolean;
  isBroker: boolean;
  isCorpHelp: boolean;
}

export interface UserSessionPayload {
  userId: number;
  userName: string;
  loginName: string;
  emailId: string;
  mobile: string;
  address: string;
  altMobile: string;
  altEmailId: string;
  empCode: string;
  maid: number;
  accessToken: string;
  activePortal: 'broker' | 'hr';
  profileImgUrl: string;
  providerCorpId: number;
  providerGroupCorpId: number;
  departmentId: string;
  brokerId?: string;
  isAdminBroker?: boolean;
  roles: UserSessionRoles;
}

// ─── Final Login Response ───────────────────────────────────────────────────

export interface AuthSessionUser {
  userId: number;
  userName: string;
  loginName: string;
  roles: UserSessionRoles;
  emailId: string;
  mobile: string;
  maid: number;
  providerCorpId: number;
  providerGroupCorpId: number;
  departmentId: string;
}

export interface AuthSessionResponse {
  success: true;
  token: string;
  user: AuthSessionUser;
}

export interface ForgetPasswordResult {
  success: boolean;
  message: string;
  multipleUsers?: boolean;
  userNames?: string[];
  token?: string;
  maskedEmail?: string;
  userName?: string;
  emailId?: string;
}

export interface FindUserResponse {
  isSuccess?: boolean;
  errorMessage?: string;
  loginName?: string;
  LoginName?: string;
  emailId?: string;
  EmailId?: string;
  userNames?: string[];
}

export interface SendOtpResponse {
  isSuccess?: boolean;
  encryptedToken?: string;
  errorMessage?: string;
}