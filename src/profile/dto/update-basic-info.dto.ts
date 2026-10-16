import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateBasicInfoDto {
  @IsNotEmpty({ message: 'Address is required' })
  @IsString({ message: 'Address must be a string' })
  address: string;

  @IsNotEmpty({ message: 'Mobile number is required' })
  @IsString({ message: 'Mobile number must be a string' })
  @MinLength(8, { message: 'Mobile number must be at least 8 digits' })
  mobile: string;

  @IsNotEmpty({ message: 'Email address is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsOptional()
  @IsString()
  altMobile?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Alternate email must be a valid email address' })
  altEmailId?: string;
}
