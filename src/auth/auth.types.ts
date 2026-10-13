export interface AuthPublicResponse {
  username: string;
  userId: number;
  applicationId: string;
  authenticated: boolean;
  isEmailVerified: boolean;
  isMobileVerified: boolean;
  accessToken: AuthAccessToken;
  roles: AuthRole[];
  features: AuthFeature[];
  isFirstLogin: boolean;
  isSuccess: boolean;
}

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

export type AuthResponse = AuthPublicResponse | AuthFailureResponse;

export interface ExternalLoginRequest {
    grant_type: string;
    username: string;
    password: string;
    applicationId: string;
    accesstoken: string;
    userAgent: string;
    emailId: string;
}