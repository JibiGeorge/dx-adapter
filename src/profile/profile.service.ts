import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { TenantService } from '../tenant/tenant.service.js';
import { LoggingService } from '../../common/logging/logging.service.js';
import { HttpService } from '../../common/http/http.service.js';
import { UserSessionPayload } from '../auth/auth.types.js';
import { UpdateBasicInfoDto } from './dto/update-basic-info.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ProfileOperationResult, UserProfileResponse } from './profile.types.js';
import type { UploadedMulterFile } from '../broker/broker.types.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Helper to resolve DMS host, MediAuth host, and app credentials for a tenant.
   * Includes defensive domain normalization (.com safeguard).
   */
  private async resolveDmsConfig(tenantId: string) {
    const isLawton =
      tenantId.includes('Lawton') ||
      tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

    let dmsHost = isLawton
      ? 'https://uat-lawton-dms.lawtonasia.com'
      : 'http://coredms.medibuddy.in';

    let appId = isLawton ? '9240' : '9237';
    let appUrl = isLawton
      ? 'https://uat-maglobal.lawtonasia.com/'
      : 'https://maglobal.mayfairwecare.in/';

    let authUrl = isLawton
      ? 'https://uat-lawton-coreauth.lawtonasia.com'
      : 'https://auth.mayfairwecare.in';

    try {
      const tenantConfig = await this.tenantService.getFullTenantById(
        tenantId.trim(),
      );
      if (tenantConfig?.config?.auth?.appId) {
        appId = String(tenantConfig.config.auth.appId);
      }
      if (tenantConfig?.config?.app?.url) {
        appUrl = tenantConfig.config.app.url.replace(/\/?$/, '/');
      }
      if (tenantConfig?.config?.auth?.api) {
        let rawApi = tenantConfig.config.auth.api.replace(/\/+$/, '');
        if (rawApi.includes('lawtonasia') && !rawApi.includes('lawtonasia.com')) {
          rawApi = rawApi.replace('lawtonasia', 'lawtonasia.com');
        }
        authUrl = rawApi;
      }
    } catch (e: any) {
      this.loggingService.warn(
        `resolveDmsConfig note: ${e.message}`,
        'ProfileService',
      );
    }

    return { dmsHost, appId, appUrl, authUrl };
  }

  /**
   * Resolve user profile details directly from upstream MediAuth or active session.
   * Zero MongoDB overrides: Single Source of Truth from backend IPMI/MediAuth.
   */
  async getProfile(
    tenantId: string,
    user: UserSessionPayload,
  ): Promise<UserProfileResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    const isLawton =
      tenantId.includes('Lawton') ||
      tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';
    const phonePrefix = isLawton ? '+66-' : '+91-';

    const { dmsHost, appId, appUrl, authUrl } =
      await this.resolveDmsConfig(tenantId);

    // 1. Fetch live user profile directly from upstream MediAuth
    let upstreamAvatar = '';
    let upstreamEmail = '';
    let upstreamMobile = '';
    let upstreamAddress = '';
    let upstreamAltMobile = '';
    let upstreamAltEmail = '';

    if (authUrl && user.accessToken) {
      try {
        const liveProfile = await this.httpService.post<any>(
          `${authUrl}/UserDetails/Profile`,
          {
            authToken: user.accessToken,
            applicationId: appId,
          },
          { tenantId },
        );

        const baseProfile =
          liveProfile?.baseProfileData ??
          liveProfile?.BaseProfileData ??
          liveProfile;

        if (baseProfile) {
          const profileImages: any[] =
            baseProfile.profileImages ?? baseProfile.ProfileImages ?? [];

          const img = profileImages.find(
            (i: any) =>
              i.imageTag === 'ProfileImgPath' ||
              i.ImageTag === 'ProfileImgPath',
          );

          let rawImg =
            img?.imagePath ??
            img?.ImagePath ??
            baseProfile.profileImgUrl ??
            baseProfile.ProfileImgUrl ??
            '';

          if (rawImg.includes('filepath=')) {
            rawImg = rawImg.split('filepath=')[1];
          } else if (rawImg.includes('/')) {
            const parts = rawImg.split('/');
            rawImg = parts[parts.length - 1];
          }
          upstreamAvatar = String(rawImg)
            .split('&')[0]
            .split('?')[0]
            .split('#')[0]
            .replace(/^\/+|\/+$/g, '');

          upstreamEmail = baseProfile.emailId || baseProfile.EmailId || '';
          upstreamMobile =
            baseProfile.mobileNo ||
            baseProfile.MobileNo ||
            baseProfile.mobile ||
            '';
          upstreamAltMobile =
            baseProfile.altMobileNo ||
            baseProfile.AltMobileNo ||
            '';
          upstreamAltEmail =
            baseProfile.altEmailId ||
            baseProfile.AltEmailId ||
            '';

          const userAddresses =
            baseProfile.userAddresses ||
            baseProfile.UserAddresses ||
            [];
          const firstAddr =
            Array.isArray(userAddresses) && userAddresses.length > 0
              ? userAddresses[0]
              : null;

          upstreamAddress =
            firstAddr?.addressLine1 ||
            firstAddr?.AddressLine1 ||
            firstAddr?.street ||
            firstAddr?.Street ||
            baseProfile.address ||
            baseProfile.Address ||
            '';
        }
      } catch (err: any) {
        this.loggingService.warn(
          `Live upstream profile lookup note: ${err.message}`,
          'ProfileService',
        );
      }
    }

    const rawMobile = upstreamMobile || user.mobile || '';
    const cleanMobile = rawMobile.replace(/^(\+66-|\+91-|\+)/, '');

    const resolvedEmail = upstreamEmail || user.emailId || '';
    const resolvedAddress = upstreamAddress || user.address || '';
    const resolvedAltMobile = upstreamAltMobile || user.altMobile || '';
    const resolvedAltEmail = upstreamAltEmail || user.altEmailId || '';

    const roleName = user.roles.isBroker
      ? 'Broker'
      : user.roles.isInsurer
        ? 'Insurer'
        : 'HR';

    // Prioritize the live upstream avatar from MediAuth, falling back to session JWT
    let resolvedAvatar = upstreamAvatar || user.profileImgUrl || '';
    if (resolvedAvatar) {
      if (
        resolvedAvatar.startsWith('data:') ||
        resolvedAvatar.startsWith('http://') ||
        resolvedAvatar.startsWith('https://')
      ) {
        // Direct URL or base64 data URI
      } else if (resolvedAvatar === '/images/profile-avatar.png') {
        resolvedAvatar = '';
      } else {
        // DMS FileGuid: route through BFF /api/profile/dms-image
        resolvedAvatar = `/api/profile/dms-image?fileGuid=${encodeURIComponent(resolvedAvatar)}`;
      }
    } else {
      resolvedAvatar = '';
    }

    return {
      userId: user.userId,
      userName: user.userName || user.loginName,
      loginName: user.loginName,
      emailId: resolvedEmail,
      mobile: cleanMobile,
      address: resolvedAddress,
      altMobile: resolvedAltMobile,
      altEmailId: resolvedAltEmail,
      profileImgUrl: resolvedAvatar,
      maid: user.maid,
      empCode: user.empCode,
      phonePrefix,
      brokerCode: user.brokerId,
      role: roleName,
    };
  }

  /**
   * Updates basic information (address, mobile, email) directly in upstream MediAuth.
   * Zero MongoDB overrides: Directly syncs to IPMI/MediAuth backend.
   */
  async updateBasicInfo(
    tenantId: string,
    user: UserSessionPayload,
    dto: UpdateBasicInfoDto,
  ): Promise<ProfileOperationResult> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    const loginName = user.loginName || user.emailId;
    const cleanMobile = (dto.mobile || '').replace(/^(\+66-|\+91-|\+)/, '').trim();
    const cleanAddress = (dto.address || '').trim();
    const cleanEmail = (dto.email || '').trim();

    try {
      const { appId, authUrl } = await this.resolveDmsConfig(tenantId);
      const isLawton =
        tenantId.includes('Lawton') ||
        tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';

      if (authUrl && user.accessToken) {
        const userAddresses = cleanAddress
          ? [
              {
                AddressTag: 'Home',
                AddressType: 'Home',
                HouseNo: 'NA',
                AddressLine1: cleanAddress,
                AddressLine2: '',
                Street: '',
                City: isLawton ? 'Bangkok' : 'London',
                State: isLawton ? 'Bangkok' : 'London',
                Pincode: isLawton ? '10110' : '000000',
                Country: isLawton ? 'Thailand' : 'UK',
                IsPrimary: true,
                IsActive: true,
              },
            ]
          : [];

        const updateRes = await this.httpService.post<any>(
          `${authUrl}/UserDetails/UpdateBaseUserProfile`,
          {
            ApplicationId: appId,
            AuthToken: user.accessToken,
            baseProfile: {
              Address: cleanAddress,
              UserAddresses: userAddresses,
              MobileNo: cleanMobile,
              EmailId: cleanEmail,
              AltMobileNo: dto.altMobile || '',
              AltEmailId: dto.altEmailId || '',
              FirstLogin: false,
            },
          },
          { tenantId },
        );
        this.loggingService.log(
          `Upstream UpdateBaseUserProfile result for ${loginName}: ${JSON.stringify(updateRes)}`,
          'ProfileService',
        );
      }
    } catch (err: any) {
      this.loggingService.warn(
        `Upstream UpdateBaseUserProfile notice: ${err.message}`,
        'ProfileService',
      );
      throw new ServiceUnavailableException('Unable to communicate with authentication service to update profile.');
    }

    return {
      success: true,
      message: 'Basic information updated successfully.',
    };
  }

  /**
   * Changes user password, verifying complexity rules and updating upstream authentication service.
   */
  async changePassword(
    tenantId: string,
    user: UserSessionPayload,
    dto: ChangePasswordDto,
  ): Promise<ProfileOperationResult> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    if (dto.newPassword !== dto.confirmPassword) {
      return {
        success: false,
        message: 'New password and confirm password do not match.',
      };
    }

    // Enforce legacy password complexity requirement:
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 digit, 1 special character
    const hasUpper = /[A-Z]/.test(dto.newPassword);
    const hasLower = /[a-z]/.test(dto.newPassword);
    const hasDigit = /\d/.test(dto.newPassword);
    const hasSpecial =
      /[~!#$@%^&*()_+|\\'\-={}[\]:";<>?,.\/]/.test(dto.newPassword);

    if (
      !hasUpper ||
      !hasLower ||
      !hasDigit ||
      !hasSpecial ||
      dto.newPassword.length < 8
    ) {
      return {
        success: false,
        message:
          'New password must contain at least 8 characters with at least one uppercase letter, one lowercase letter, one digit, and one special character.',
      };
    }

    // Call upstream MediAuth ChangePassword service
    try {
      const { appId, authUrl } = await this.resolveDmsConfig(tenantId);

      if (authUrl) {
        const res = await this.httpService.post<any>(
          `${authUrl}/ChangePassword/UserName`,
          {
            newPassword: dto.newPassword,
            oldPassword: dto.oldPassword,
            retypePassword: dto.confirmPassword,
            userName: user.loginName,
            applicationId: appId,
            providers: ['IWP', 'Medibuddy'],
          },
          { tenantId },
        );

        if (res && res.isSuccess) {
          return {
            success: true,
            message: 'Password changed successfully.',
          };
        } else if (res && res.message) {
          return {
            success: false,
            message: res.message,
          };
        }
      }
    } catch (err: any) {
      this.loggingService.warn(
        `Upstream ChangePassword note: ${err.message}`,
        'ProfileService',
      );
      return {
        success: false,
        message: 'Failed to update password in authentication service. Please verify your current password.',
      };
    }

    return {
      success: true,
      message: 'Password changed successfully.',
    };
  }

  /**
   * Uploads and updates the user's profile picture across central DMS and upstream MediAuth.
   * Zero MongoDB overrides: DMS provides the asset, MediAuth stores the FileGuid reference.
   */
  async uploadProfilePicture(
    tenantId: string,
    user: UserSessionPayload,
    file?: UploadedMulterFile,
  ): Promise<ProfileOperationResult> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const allowed = ['.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      throw new BadRequestException(
        'Allowed Profile pic extensions : png, jpg, jpeg',
      );
    }

    const loginName = user.loginName || user.emailId;
    let base64Url = '';

    if (file.buffer) {
      base64Url = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    }

    const { dmsHost, appId, appUrl, authUrl } =
      await this.resolveDmsConfig(tenantId);

    // 1. Upload to Central DMS so that all microservices share the exact same asset
    let dmsFileGuid = '';
    try {
      const formData = new FormData();
      formData.append('UserName', loginName);
      formData.append('FileType', 'Profile');
      formData.append('FolderName', '');

      const blob = new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype,
      });
      formData.append('file', blob, file.originalname);

      const dmsRes = await fetch(`${dmsHost}/UploadFile`, {
        method: 'POST',
        body: formData,
        headers: {
          mbappid: appId,
          mbappurl: appUrl,
        },
      });

      if (dmsRes.ok) {
        const dmsData = (await dmsRes.json()) as any;
        dmsFileGuid =
          dmsData?.uploadedDetails?.[0]?.fileGuid ||
          dmsData?.UploadedDetails?.[0]?.FileGuid ||
          '';
        this.loggingService.log(
          `DMS upload successful for ${loginName}, fileGuid: ${dmsFileGuid}`,
          'ProfileService',
        );
      } else {
        this.loggingService.warn(
          `DMS upload responded with status ${dmsRes.status}`,
          'ProfileService',
        );
      }
    } catch (dmsErr: any) {
      this.loggingService.warn(
        `Failed to upload to central DMS: ${dmsErr.message}`,
        'ProfileService',
      );
    }

    // 2. Sync to upstream MediAuth with the DMS FileGuid and full baseProfile (legacy portal pattern)
    const imagePayload = dmsFileGuid || base64Url;
    if (authUrl && user.accessToken && imagePayload) {
      try {
        const cleanMobile = (user.mobile || '').replace(/^(\+66-|\+91-|\+)/, '').trim();
        const syncRes = await this.httpService.post<any>(
          `${authUrl}/UserDetails/UpdateBaseUserProfile`,
          {
            ApplicationId: appId,
            AuthToken: user.accessToken,
            baseProfile: {
              Address: user.address || '',
              MobileNo: cleanMobile,
              EmailId: user.emailId || '',
              FirstLogin: false,
              ProfileImages: [
                {
                  ImageTag: 'ProfileImgPath',
                  ImagePath: imagePayload,
                  IsActive: true,
                },
              ],
            },
          },
          { tenantId },
        );
        this.loggingService.log(
          `Profile picture synced to upstream MediAuth for user ${loginName} with guid: ${dmsFileGuid}: ${JSON.stringify(syncRes)}`,
          'ProfileService',
        );
        if (syncRes && syncRes.isSuccess === false) {
          this.loggingService.warn(
            `MediAuth UpdateBaseUserProfile returned false: ${syncRes.errorMessage || syncRes.message}`,
            'ProfileService',
          );
        }
      } catch (err: any) {
        this.loggingService.warn(
          `Upstream MediAuth profile picture sync note: ${err.message}`,
          'ProfileService',
        );
      }
    }

    const resolvedReturnImg = dmsFileGuid
      ? `/api/profile/dms-image?fileGuid=${encodeURIComponent(dmsFileGuid)}`
      : base64Url;

    return {
      success: true,
      message: 'Profile picture updated successfully.',
      profileImgUrl: resolvedReturnImg,
    };
  }

  /**
   * Downloads a profile image file from central DMS using its FileIdentifier / fileGuid.
   */
  async downloadDmsImage(
    tenantId: string,
    fileGuid: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const { dmsHost, appId, appUrl } = await this.resolveDmsConfig(tenantId);

    const res = await fetch(`${dmsHost}/DownloadFile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        mbappid: appId,
        mbappurl: appUrl,
      },
      body: JSON.stringify({ FileIdentifier: fileGuid }),
    });

    if (!res.ok) {
      throw new NotFoundException(`DMS image not found for guid: ${fileGuid}`);
    }

    const data = (await res.json()) as any;
    if (!data?.fileBytes) {
      throw new NotFoundException(
        `DMS response has no file content for guid: ${fileGuid}`,
      );
    }

    const buffer = Buffer.from(data.fileBytes, 'base64');
    const ext = (data.fileName || '').split('.').pop()?.toLowerCase();
    const contentType =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : 'application/octet-stream';

    return { buffer, contentType };
  }
}
