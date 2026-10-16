import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Collection } from 'mongoose';
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
  private readonly overridesCollection: Collection | null = null;

  constructor(
    private readonly tenantService: TenantService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectConnection() connection: Connection,
  ) {
    const dbName = this.configService.get<string>('CONFIG_MONGO_DB');
    if (dbName) {
      this.overridesCollection = connection
        .useDb(dbName)
        .collection('UserProfileOverrides');
    } else {
      this.loggingService.warn(
        'CONFIG_MONGO_DB is not defined in environment. UserProfileOverrides queries will be skipped.',
        'ProfileService',
      );
    }
  }

  /**
   * Helper to resolve DMS host and app credentials for a tenant.
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

    let authUrl = '';

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
        authUrl = tenantConfig.config.auth.api.replace(/\/+$/, '');
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
   * Resolve user profile details, prioritizing database overrides and tenant-specific formatting.
   */
  async getProfile(
    tenantId: string,
    user: UserSessionPayload,
  ): Promise<UserProfileResponse> {
    if (!tenantId?.trim()) {
      throw new BadRequestException('x-tenant-id header is required');
    }

    const loginName = user.loginName || user.emailId;
    let override: Record<string, any> | null = null;
    if (this.overridesCollection) {
      try {
        override = await this.overridesCollection.findOne({
          loginName: { $regex: new RegExp(`^${loginName}$`, 'i') },
        });
      } catch (err: any) {
        this.loggingService.warn(
          `Failed to query UserProfileOverrides: ${err.message}`,
          'ProfileService',
        );
      }
    }

    // Tenant-specific phone prefix: Lawton Asia uses Thai mobile prefix (+66-), Mayfair uses standard (+91- / international)
    const isLawton =
      tenantId.includes('Lawton') ||
      tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';
    const phonePrefix = isLawton ? '+66-' : '+91-';

    const { dmsHost, appId, appUrl, authUrl } =
      await this.resolveDmsConfig(tenantId);

    // 1. Fetch live user profile directly from upstream MediAuth so updates from UAT portal or external systems reflect immediately
    let upstreamAvatar = '';
    let upstreamEmail = '';
    let upstreamMobile = '';
    let upstreamAddress = '';

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
            (i) =>
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

    // Prioritize live upstream values so updates in external systems reflect immediately
    const rawMobile =
      upstreamMobile ||
      override?.mobile ||
      user.mobile ||
      '';
    const cleanMobile = rawMobile.replace(/^(\+66-|\+91-|\+)/, '');

    const resolvedEmail = upstreamEmail || override?.emailId || user.emailId;
    const resolvedAddress = upstreamAddress || override?.address || user.address || '';

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
      altMobile: override?.altMobile ?? user.altMobile ?? '',
      altEmailId: override?.altEmailId ?? user.altEmailId ?? '',
      profileImgUrl: resolvedAvatar,
      maid: user.maid,
      empCode: user.empCode,
      phonePrefix,
      brokerCode: user.brokerId,
      role: roleName,
    };
  }

  /**
   * Updates basic information (address, mobile, email) in upstream auth service and local database.
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

    // 1. Update in local MongoDB overrides for instant consistency across portals
    if (this.overridesCollection) {
      try {
        await this.overridesCollection.updateOne(
          { loginName: { $regex: new RegExp(`^${loginName}$`, 'i') } },
          {
            $set: {
              tenantId,
              loginName,
              address: cleanAddress,
              mobile: cleanMobile,
              emailId: cleanEmail,
              altMobile: dto.altMobile || '',
              altEmailId: dto.altEmailId || '',
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
      } catch (err: any) {
        this.loggingService.warn(
          `Failed to persist profile override in MongoDB: ${err.message}`,
          'ProfileService',
        );
      }
    }

    // 2. Forward to upstream MediAuth if configured
    try {
      const tenantConfig = await this.tenantService.getFullTenantById(
        tenantId.trim(),
      );
      const authUrl = tenantConfig.config.auth.api?.replace(/\/+$/, '');
      const appId = String(tenantConfig.config.auth.appId);

      if (authUrl && user.accessToken) {
        const isLawton = tenantId === 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';
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
      const tenantConfig = await this.tenantService.getFullTenantById(
        tenantId.trim(),
      );
      const authUrl = tenantConfig.config.auth.api?.replace(/\/+$/, '');
      const appId = String(tenantConfig.config.auth.appId);

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
    }

    return {
      success: true,
      message: 'Password changed successfully.',
    };
  }

  /**
   * Uploads and updates the user's profile picture across central DMS, upstream MediAuth, and local database.
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

    // 1. Upload to Central DMS so that UAT portal and all microservices share the exact same asset
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

    // 2. Persist DMS FileGuid and metadata into MongoDB overrides (do not store competing base64 profileImgUrl)
    if (this.overridesCollection) {
      try {
        await this.overridesCollection.updateOne(
          { loginName: { $regex: new RegExp(`^${loginName}$`, 'i') } },
          {
            $set: {
              tenantId,
              loginName,
              dmsFileGuid: dmsFileGuid || '',
              updatedAt: new Date(),
            },
            $unset: {
              profileImgUrl: '',
            },
          },
          { upsert: true },
        );
      } catch (err: any) {
        this.loggingService.warn(
          `Failed to persist avatar in MongoDB: ${err.message}`,
          'ProfileService',
        );
      }
    }

    // 3. Sync to upstream MediAuth with the DMS FileGuid (legacy portal expects FileGuid)
    const imagePayload = dmsFileGuid || base64Url;
    if (authUrl && user.accessToken && imagePayload) {
      try {
        await this.httpService.post(
          `${authUrl}/UserDetails/UpdateBaseUserProfile`,
          {
            ApplicationId: appId,
            AuthToken: user.accessToken,
            baseProfile: {
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
          `Profile picture synced to upstream MediAuth for user ${loginName} with guid: ${dmsFileGuid}`,
          'ProfileService',
        );
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
