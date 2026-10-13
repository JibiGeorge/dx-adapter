import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TenantService } from '../tenant/tenant.service';
import { TenantConfigTypes } from '../tenant/tenant.types';
import {
  AuthResponse,
  AuthSessionResponse,
  FindUserResponse,
  ForgetPasswordResult,
  ProfileOverrides,
  SendOtpResponse,
  UserSessionPayload,
} from './auth.types';
import { LoggingService } from '../../common/logging/logging.service';
import { HttpService } from '../../common/http/http.service';
import { ForgetPasswordDto } from './dto/forget-password.dto';
import { ResetPasswordOtpDto } from './dto/reset-password.dto';

type Data = Record<string, any>;

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly loggingService: LoggingService,
    private readonly jwtService: JwtService,
    private readonly httpService: HttpService,
  ) { }

  async authLogin(
    tenantId: string,
    username: string,
    password: string,
  ): Promise<AuthResponse | AuthSessionResponse> {
    if (!tenantId?.trim()) {
      throw new ServiceUnavailableException(
        'Tenant identification is required.',
      );
    }

    const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(tenantId.trim());

    const authUrl = tenantConfig.config.auth.api?.replace(/\/+$/, '');
    const appId = String(tenantConfig.config.auth.appId);

    if (!authUrl) {
      throw new ServiceUnavailableException(
        'Authentication service is not configured for this tenant.',
      );
    }

    // Step 1: Authenticate the user.
    const authData = await this.postJson(
      `${authUrl}/SignIn/Password`,
      {
        grant_type: '',
        username,
        password,
        applicationId: appId,
        accesstoken: '',
        userAgent: '',
        emailId: '',
      },
      tenantId,
    );

    if (!this.isAuthResponse(authData)) {
      throw new BadGatewayException(
        'The authentication service returned an unexpected response.',
      );
    }

    // Preserve business-level authentication failures.
    if (!authData.isSuccess) {
      this.loggingService.debug(
        `Authentication failed for tenant ${tenantId}.`,
      );

      return authData;
    }

    const accessToken = authData.accessToken.access_token;

    if (!accessToken) {
      throw new BadGatewayException(
        'The authentication service did not return an access token.',
      );
    }

    // Step 2: Fetch the user's profile.
    const profile = await this.postJson(
      `${authUrl}/UserDetails/Profile`,
      {
        authToken: accessToken,
        applicationId: appId,
      },
      tenantId,
    );

    if (!this.isRecord(profile)) {
      throw new BadGatewayException(
        'The profile service returned an unexpected response.',
      );
    }

    // Step 3: Extract profile information.
    const baseProfile: Data =
      profile.BaseProfileData ??
      profile.baseProfileData ??
      profile.baseProfile?.BaseProfileData ??
      profile.baseProfile ??
      profile;

    const rolesFeatures: Data =
      profile.RolesFeatures ??
      profile.rolesFeatures ??
      { Roles: [], Features: [] };

    const propertyData: Data =
      profile.PropertyData ?? profile.propertyData ?? {};

    // Step 4: Resolve corporate IDs.
    const providerCorpId = this.getNumberValue(
      this.getProp(propertyData, 'providercorpid'),
      baseProfile.EntityId,
      baseProfile.entityId,
    );

    const providerGroupCorpId = this.getNumberValue(
      this.getProp(propertyData, 'providergroupcorpid'),
    );

    // Step 5: Resolve user details.
    const firstName =
      baseProfile.FirstName ??
      baseProfile.firstName ??
      authData.username ??
      username;

    const loginName =
      baseProfile.UserName ??
      baseProfile.userName ??
      username;

    const emailId =
      baseProfile.EmailId ??
      baseProfile.emailId ??
      authData.emailId ??
      '';

    let mobile =
      baseProfile.MobileNo ??
      baseProfile.mobileNo ??
      authData.mobile ??
      '';

    const maid = this.getNumberValue(
      baseProfile.Maid,
      baseProfile.maid,
      authData.maid,
      authData.MAID,
    );

    const empCode =
      baseProfile.EmployeeId ??
      baseProfile.employeeId ??
      '';

    const userId = this.getNumberValue(
      profile.UserId,
      profile.userId,
      authData.userId,
    );

    const departmentId =
      this.getProp(propertyData, 'departmentid') ?? '';

    // Step 6: Detect user roles.
    const roles: Data[] =
      rolesFeatures.Roles ?? rolesFeatures.roles ?? [];

    const firstRoleName = String(
      roles[0]?.RoleName ?? roles[0]?.roleName ?? '',
    ).toUpperCase();

    const agentIdProp = this.getProp(
      propertyData,
      'tpa_agentid',
    );

    const brokerIdProp =
      this.getProp(propertyData, 'tpa_brokerid') ||
      this.getProp(propertyData, 'tpa_mandatebroker_id');

    const roCodesProp = this.getProp(propertyData, 'ro_codes');
    const doCodesProp = this.getProp(propertyData, 'do_codes');
    const boCodesProp = this.getProp(propertyData, 'bo_codes');

    const insCompIdProp =
      this.getProp(propertyData, 'inscompid') ||
      this.getProp(propertyData, 'ins_codes');

    const isAgent = Boolean(agentIdProp);
    const isBroker = !isAgent && Boolean(brokerIdProp);

    const isInsurer =
      !isAgent &&
      !isBroker &&
      Boolean(
        roCodesProp ||
        doCodesProp ||
        boCodesProp ||
        insCompIdProp,
      );

    const isCorpHelp =
      !isAgent &&
      !isBroker &&
      !isInsurer &&
      providerCorpId > 0 &&
      firstRoleName === 'CRM';

    const isCorpHR =
      !isAgent &&
      !isBroker &&
      !isInsurer &&
      !isCorpHelp &&
      (providerCorpId > 0 || providerGroupCorpId > 0) &&
      firstRoleName === 'HRPREEMPLOYMENT';

    const isAdminBroker =
      isBroker &&
      (
        firstRoleName === 'ADMIN' ||
        Boolean(
          this.getProp(
            propertyData,
            'tpa_mandatebroker_id',
          ),
        )
      );

    // Step 7: Resolve profile image.
    const profileImages: Data[] =
      baseProfile.ProfileImages ??
      baseProfile.profileImages ??
      [];

    const profileImage = profileImages.find(
      (image) =>
        image.ImageTag === 'ProfileImgPath' ||
        image.imageTag === 'ProfileImgPath',
    );

    let rawProfileImgUrl =
      profileImage?.ImagePath ??
      profileImage?.imagePath ??
      baseProfile.ProfileImgUrl ??
      baseProfile.profileImgUrl ??
      '';

    if (rawProfileImgUrl.includes('filepath=')) {
      rawProfileImgUrl =
        rawProfileImgUrl.split('filepath=')[1];
    } else if (rawProfileImgUrl.includes('/')) {
      const parts = rawProfileImgUrl.split('/');
      rawProfileImgUrl = parts[parts.length - 1];
    }

    const profileImgUrl = String(rawProfileImgUrl)
      .split('&')[0]
      .split('?')[0]
      .split('#')[0]
      .replace(/^\/+|\/+$/g, '');

    // Step 8: Resolve the user's address and overrides.
    const userAddresses: Data[] =
      baseProfile.UserAddresses ??
      baseProfile.userAddresses ??
      profile.UserAddresses ??
      profile.userAddresses ??
      [];

    const firstAddress =
      Array.isArray(userAddresses) && userAddresses.length > 0
        ? userAddresses[0]
        : {};

    const loginScope: 'broker' | 'hr' =
      isBroker ? 'broker' : 'hr';

    const overrides = await this.getProfileOverrides(
      loginName,
      loginScope,
    );

    const address =
      overrides.address ??
      baseProfile.Address ??
      baseProfile.address ??
      profile.Address ??
      profile.address ??
      this.getProp(propertyData, 'address') ??
      firstAddress.AddressLine1 ??
      firstAddress.addressLine1 ??
      '';

    mobile = overrides.mobile ?? mobile;

    const altMobile =
      overrides.altMobile ??
      baseProfile.AltMobileNo ??
      baseProfile.altMobileNo ??
      baseProfile.AltMobile ??
      baseProfile.altMobile ??
      profile.AltMobileNo ??
      profile.altMobileNo ??
      this.getProp(propertyData, 'altmobile') ??
      '';

    const altEmailId =
      overrides.altEmailId ??
      baseProfile.AltEmailId ??
      baseProfile.altEmailId ??
      profile.AltEmailId ??
      profile.altEmailId ??
      this.getProp(propertyData, 'altemailid') ??
      '';

    const resolvedProfileImgUrl =
      overrides.profileImgUrl ?? profileImgUrl ?? '';

    // Step 9: Build the session payload.
    const payload: UserSessionPayload = {
      userId,
      userName: firstName,
      loginName,
      emailId,
      mobile,
      address,
      altMobile,
      altEmailId,
      empCode,
      maid,
      accessToken,
      activePortal: loginScope,
      profileImgUrl: resolvedProfileImgUrl,
      providerCorpId,
      providerGroupCorpId,
      departmentId,
      brokerId: isBroker
        ? String(brokerIdProp ?? '')
        : undefined,
      isAdminBroker: isBroker
        ? isAdminBroker
        : undefined,
      roles: {
        isAgent,
        isScheme: false,
        isCorpHR,
        isInsurer,
        isBroker,
        isCorpHelp,
      },
    };

    // Step 10: Generate the application's session JWT.
    const token = await this.jwtService.signAsync(payload);

    this.loggingService.debug(
      `Login completed for tenant ${tenantId}; ` +
      `corpId=${providerCorpId}; ` +
      `groupCorpId=${providerGroupCorpId}; ` +
      `role=${firstRoleName}; ` +
      `isBroker=${isBroker}`,
    );

    // Step 11: Return the application session response.
    return {
      success: true,
      token,
      user: {
        userId: payload.userId,
        userName: payload.userName,
        loginName: payload.loginName,
        roles: payload.roles,
        emailId: payload.emailId,
        mobile: payload.mobile,
        maid: payload.maid,
        providerCorpId: payload.providerCorpId,
        providerGroupCorpId: payload.providerGroupCorpId,
        departmentId: payload.departmentId,
      },
    };
  }

  private async postJson<T = unknown>(
    url: string,
    body: Record<string, unknown>,
    tenantId: string,
  ): Promise<T> {
    return this.httpService.post<T>(url, body, { tenantId });
  }

  private getProp(
    properties: Data,
    key: string,
  ): string | undefined {
    const matchingKey = Object.keys(properties).find(
      (property) => property.toLowerCase() === key.toLowerCase(),
    );

    const value = matchingKey
      ? properties[matchingKey]
      : undefined;

    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    return String(value);
  }

  private getNumberValue(...values: unknown[]): number {
    for (const value of values) {
      if (
        value !== null &&
        value !== undefined &&
        value !== ''
      ) {
        const number = Number(value);

        if (Number.isFinite(number)) {
          return number;
        }
      }
    }

    return 0;
  }

  private isRecord(value: unknown): value is Data {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private isAuthResponse(
    value: unknown,
  ): value is AuthResponse {
    if (!this.isRecord(value)) {
      return false;
    }

    if (
      typeof value.userId !== 'number' ||
      typeof value.authenticated !== 'boolean' ||
      typeof value.isEmailVerified !== 'boolean' ||
      typeof value.isMobileVerified !== 'boolean' ||
      typeof value.isFirstLogin !== 'boolean' ||
      typeof value.isSuccess !== 'boolean'
    ) {
      return false;
    }

    if (value.isSuccess === false) {
      return (
        typeof value.errorMessage === 'string' &&
        typeof value.errorDescription === 'string'
      );
    }

    return (
      typeof value.username === 'string' &&
      typeof value.applicationId === 'string' &&
      this.isRecord(value.accessToken) &&
      typeof value.accessToken.access_token === 'string' &&
      Array.isArray(value.roles) &&
      Array.isArray(value.features)
    );
  }

  private async getProfileOverrides(
    loginName: string,
    scope: 'broker' | 'hr',
  ): Promise<ProfileOverrides> {
    // TODO: Connect your existing profile-override database/service.
    // Return {} until that integration is implemented.
    void loginName;
    void scope;

    return {};
  }

  async forgetPassword(tenantId: string, dto: ForgetPasswordDto): Promise<ForgetPasswordResult> {
    if (!tenantId?.trim()) {
      throw new ServiceUnavailableException('Tenant identification is required.');
    }

    const queryUser = String(dto.selectedUserName || dto.userName || '').trim();
    const queryEmail = String(dto.emailId || '').trim();

    if (!queryUser && !queryEmail) {
      throw new BadRequestException({
        success: false,
        message: 'Please input either of values (User name or Email Id).',
      });
    }

    const tenantConfig: TenantConfigTypes = await this.tenantService.getFullTenantById(tenantId.trim());

    const authUrl = tenantConfig.config.auth.api?.replace(/\/+$/, '');
    const applicationId = String(tenantConfig.config.auth.appId);
    const appName = tenantConfig.config.app?.name || 'Application';

    if (!authUrl) {
      throw new ServiceUnavailableException(
        'Authentication service is not configured for this tenant.',
      );
    }

    // 1. Locate the user.
    const findData = await this.postJson<FindUserResponse>(
      `${authUrl}/Search/FindUser`,
      {
        emailId: queryEmail,
        userName: queryUser,
        applicationId,
      },
      tenantId,
    );

    if (
      findData.errorMessage === 'Multiple_User_Found' ||
      (Array.isArray(findData.userNames) && findData.userNames.length > 1)
    ) {
      return {
        success: false,
        multipleUsers: true,
        userNames: findData.userNames ?? [],
        message:
          'Multiple user names exist with the given mail id. Please select the user name from the drop down.',
      };
    }

    if (findData.errorMessage === 'Account_Locked') {
      return {
        success: false,
        message: 'Your account has been locked, please try after 20 mins.',
      };
    }

    const resolvedUserName = findData.loginName || findData.LoginName || queryUser;

    if (!findData.isSuccess && !findData.loginName && !findData.LoginName) {
      return {
        success: false,
        message: 'No user exists with such username/emailid.',
      };
    }

    const resolvedEmail = findData.emailId || findData.EmailId || queryEmail;

    if (!resolvedEmail) {
      return {
        success: false,
        message:
          'No registered email found for this user account. Please contact support.',
      };
    }

    // 2. Send the OTP email.
    const emailTemplate = this.getForgetPasswordEmailTemplate(appName);

    const otpData = await this.postJson<SendOtpResponse>(
      `${authUrl}/ChangePassword/Email`,
      {
        applicationId,
        userName: resolvedUserName,
        emailId: resolvedEmail,
        emailTemplate,
        emailSubject: `Forget Password OTP Verification - ${appName}`,
      },
      tenantId,
    );

    if (otpData.isSuccess) {
      const maskedEmail = this.maskEmail(resolvedEmail);

      return {
        success: true,
        token: otpData.encryptedToken,
        maskedEmail,
        userName: resolvedUserName,
        emailId: resolvedEmail,
        message: `OTP has been sent to your registered EmailId - ${maskedEmail}`,
      };
    }

    if (otpData.errorMessage?.toLowerCase() === 'otp_already_sent') {
      return {
        success: false,
        message:
          "Sorry, OTP already sent, password reset doesn't work now. Please try again after 2 minutes.",
      };
    }

    return {
      success: false,
      message:
        otpData.errorMessage ||
        'Sorry, something went wrong. Please try again after sometime.',
    };
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return '***';
    }

    const local = parts[0];

    if (local.length > 2) {
      return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${parts[1]}`;
    }

    return `${local[0]}*@${parts[1]}`;
  }

  private getForgetPasswordEmailTemplate(appName: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName}</title>
</head>
<body>
  <p>Dear User,</p>
  <p><strong>[OTP]</strong> is your OTP for Forget Password.
  For security reasons, do not share your OTP with anyone.</p>
  <p style="font-size:14px;color:#424242;font-family:Arial,sans-serif;margin-bottom:16px;">
    Use the following one-time password (OTP) to continue with your
    ${appName} account password reset.
  </p>
  <p><i>This is a system-generated email. Please do not respond.</i></p>
  <p>Regards,<br>Team ${appName}</p>
</body>
</html>`;
  }

  async resetPasswordOtp(tenantId: string, dto: ResetPasswordOtpDto): Promise<any> {
    if (!tenantId?.trim()) {
      throw new ServiceUnavailableException('Tenant identification is required.');
    }

    if (!dto.userName || !dto.otp || dto.newPassword || dto.confirmPassword || dto.token) {
      throw new BadRequestException({
        success: false,
        message: 'All fields (User Name, OTP, New Password, Confirm Password, Token) are required.',
      });
    }

    if (dto.newPassword !== dto.confirmPassword) {
      return {
        success: false,
        message: 'New Password and Confirm Password do not match.',
      };
    }

    // Complexity check: matches legacy IsComplexPassword
    const hasUpper = /[A-Z]/.test(dto.newPassword);
    const hasLower = /[a-z]/.test(dto.newPassword);
    const specialChars = '%!@#$%^&*()?/>.<,:;\'\\|}{][~`+=–"-';
    let hasSpecial = false;
    for (const ch of specialChars) {
      if (dto.newPassword.includes(ch)) {
        hasSpecial = true;
        break;
      }
    }

    if (!hasUpper || !hasLower || !hasSpecial || dto.newPassword.length < 8) {
      return {
        success: false,
        message: 'Password must contain at least 8 characters, with at least one uppercase letter, one lowercase letter, and one special character.',
      };
    }

    const tenantConfig = await this.tenantService.getFullTenantById(tenantId);
    const authUrl = tenantConfig.config.auth.api?.replace(/\/+$/, '');
    const applicationId = String(tenantConfig.config.auth.appId);

    if (!authUrl) {
      throw new ServiceUnavailableException(
        'Authentication service is not configured for this tenant.',
      );
    }

    const resetResult = await this.postJson<any>(
      `${authUrl}/ChangePassword/Email`,
      {
        applicationId,
        userName: dto.userName,
        emailId: dto.emailId,
        otpToVerify: String(dto.otp).trim(),
        newPassword: dto.newPassword,
        encryptedToken: dto.token,
      },
      tenantId,
    );

    if (resetResult.isSuccess) {
      return {
        success: true,
        message: 'Password changed successfully.',
      };
    }

    if (resetResult.errorMessage?.toLowerCase() === 'incorrect_otp') {
      return {
        success: false,
        message: 'Incorrect OTP. Please check the code and try again.',
      };
    }
    return {
      success: false,
      message: 'Your password cannot be changed, please try again.',
    };

  }
}