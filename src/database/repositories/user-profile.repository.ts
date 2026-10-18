import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Collection } from 'mongoose';
import { LoggingService } from '../../../common/logging/logging.service.js';

export interface UserProfileOverrides {
  address?: string;
  mobile?: string;
  altMobile?: string;
  altEmailId?: string;
  profileImgUrl?: string;
  profileImgData?: string;
}

export function buildProfileKey(loginName: string, scope?: string): string {
  const cleanLogin = (loginName || '').toLowerCase().trim();
  const cleanScope = (scope || '').toLowerCase().trim();
  return cleanScope ? `${cleanLogin}:${cleanScope}` : cleanLogin;
}

@Injectable()
export class UserProfileRepository {
  private readonly collection: Collection;
  private readonly inMemoryProfileStore = new Map<string, UserProfileOverrides>();

  constructor(
    @InjectConnection()
    connection: Connection,
    configService: ConfigService,
    private readonly logger: LoggingService,
  ) {
    const dbName =
      configService.get<string>('USER_PROFILE_MONGO_DB') ||
      configService.get<string>('CONFIG_MONGO_DB') ||
      'IPMI_Tenant_STG';
    const collectionName =
      configService.get<string>('USER_PROFILE_MONGO_COLLECTION') ||
      'user-profiles';

    this.collection = connection.useDb(dbName).collection(collectionName);
  }

  async getProfileOverrides(loginName: string, scope?: string): Promise<UserProfileOverrides> {
    if (!loginName) return {};

    const key = buildProfileKey(loginName, scope);
    let stored = this.inMemoryProfileStore.get(key);

    if (!stored) {
      try {
        const dbDoc =
          (await this.collection.findOne<Record<string, any>>({ loginKey: key })) ||
          (scope ? null : await this.collection.findOne<Record<string, any>>({ loginName: key }));

        if (dbDoc) {
          stored = {
            address: dbDoc.address,
            mobile: dbDoc.mobile,
            altMobile: dbDoc.altMobile,
            altEmailId: dbDoc.altEmailId,
            profileImgUrl: dbDoc.profileImgUrl,
            profileImgData: dbDoc.profileImgData,
          };
          this.inMemoryProfileStore.set(key, stored);
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to fetch profile overrides from MongoDB for ${key}: ${err?.message}`,
          UserProfileRepository.name,
        );
      }
    }

    if (!stored && !scope) {
      const fallbackKey = buildProfileKey(loginName);
      stored = this.inMemoryProfileStore.get(fallbackKey);
    }

    return stored || {};
  }

  setInMemoryOverride(key: string, overrides: UserProfileOverrides): void {
    this.inMemoryProfileStore.set(key, overrides);
  }

  async saveProfileOverrides(
    loginName: string,
    overrides: UserProfileOverrides,
    scope?: string,
  ): Promise<void> {
    if (!loginName) return;
    const key = buildProfileKey(loginName, scope);
    const existing = this.inMemoryProfileStore.get(key) || {};
    const updated: UserProfileOverrides = { ...existing };

    if (overrides.address !== undefined) updated.address = overrides.address;
    if (overrides.mobile !== undefined) updated.mobile = overrides.mobile;
    if (overrides.altMobile !== undefined) updated.altMobile = overrides.altMobile;
    if (overrides.altEmailId !== undefined) updated.altEmailId = overrides.altEmailId;
    if (overrides.profileImgUrl !== undefined) updated.profileImgUrl = overrides.profileImgUrl;
    if (overrides.profileImgData !== undefined) updated.profileImgData = overrides.profileImgData;

    this.inMemoryProfileStore.set(key, updated);

    try {
      await this.collection.updateOne(
        { loginKey: key },
        {
          $set: {
            ...updated,
            loginKey: key,
            loginName: loginName.toLowerCase().trim(),
            scope: (scope || '').toLowerCase().trim(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (err: any) {
      this.logger.debug(
        `Profile override saved in memory for ${key} (DB error: ${err?.message})`,
        UserProfileRepository.name,
      );
    }
  }
}

