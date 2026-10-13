import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ResetPasswordOtpDto {
  @IsString()
  @MaxLength(150)
  userName: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  emailId?: string;

  @IsString()
  @MaxLength(150)
  otp: string;

  @IsString()
  @MaxLength(150)
  newPassword: string;

  @IsString()
  @MaxLength(150)
  confirmPassword: string;

  @IsString()
  @MaxLength(150)
  token: string;
}