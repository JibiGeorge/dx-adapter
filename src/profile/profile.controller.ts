import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UserSessionPayload } from '../auth/auth.types.js';
import { ProfileService } from './profile.service.js';
import { UpdateBasicInfoDto } from './dto/update-basic-info.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ProfileOperationResult, UserProfileResponse } from './profile.types.js';
import type { UploadedMulterFile } from '../broker/broker.types.js';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getProfile(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
  ): Promise<UserProfileResponse> {
    return this.profileService.getProfile(tenantId, user);
  }

  @Get('dms-image')
  async getDmsImage(
    @Headers('x-tenant-id') tenantId: string,
    @Query('fileGuid') fileGuid: string,
    @Res() res: Response,
  ) {
    if (!fileGuid) {
      throw new BadRequestException('fileGuid query parameter is required');
    }
    const tenant = tenantId || 'MzAyNHxMYXd0b25Bc2lhIzIwMjZATWF5';
    const { buffer, contentType } = await this.profileService.downloadDmsImage(
      tenant,
      fileGuid,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  }

  @Put('basic-info')
  @UseGuards(JwtAuthGuard)
  async updateBasicInfo(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: UpdateBasicInfoDto,
  ): Promise<ProfileOperationResult> {
    return this.profileService.updateBasicInfo(tenantId, user, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<ProfileOperationResult> {
    return this.profileService.changePassword(tenantId, user, dto);
  }

  @Post('picture')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePicture(
    @Headers('x-tenant-id') tenantId: string,
    @CurrentUser() user: UserSessionPayload,
    @UploadedFile() file?: UploadedMulterFile,
  ): Promise<ProfileOperationResult> {
    return this.profileService.uploadProfilePicture(tenantId, user, file);
  }
}
