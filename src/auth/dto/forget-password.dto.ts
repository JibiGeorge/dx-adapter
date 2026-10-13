import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ForgetPasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  userName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  emailId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  selectedUserName?: string;
}