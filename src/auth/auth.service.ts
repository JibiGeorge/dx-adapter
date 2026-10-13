import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TenantService } from '../tenant/tenant.service';
import { TenantConfigTypes } from '../tenant/tenant.types';
import {
  AuthResponse,
  AuthSessionResponse,
  ProfileOverrides,
  UserSessionPayload,
} from './auth.types';
import { LoggingService } from '../../common/logging/logging.service';

const AUTH_API_TIMEOUT_MS = 10_000;

type Data = Record<string, any>;

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly loggingService: LoggingService,
    private readonly jwtService: JwtService,
  ) {}

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

    const tenantConfig: TenantConfigTypes =
      await this.tenantService.getFullTenantById(tenantId.trim());

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

  private async postJson(
    url: string,
    body: Record<string, unknown>,
    tenantId: string,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AUTH_API_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.name : 'UnknownError';

      this.loggingService.error(
        `Upstream request failed for tenant ${tenantId}. Reason: ${reason}`,
      );

      throw new ServiceUnavailableException(
        'An upstream authentication service is temporarily unavailable.',
      );
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      throw new BadGatewayException(
        'An upstream service returned invalid JSON.',
      );
    }

    if (!response.ok) {
      this.loggingService.error(
        `Upstream request returned HTTP ${response.status} for tenant ${tenantId}.`,
      );

      throw new BadGatewayException(
        'An upstream service could not process the request.',
      );
    }

    return data;
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
}