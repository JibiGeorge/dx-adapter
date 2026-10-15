import { Body, Controller, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthLoginDto } from "./dto/auth-login.dto";
import { ForgetPasswordDto } from "./dto/forget-password.dto";
import { ResetPasswordOtpDto } from "./dto/reset-password.dto";

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    authLogin(
        @Headers('x-tenant-id') tenantId: string,
        @Headers('x-role') roleHeader: string,
        @Headers('role') altRoleHeader: string,
        @Body() body: AuthLoginDto,
    ) {
        const requestedRole = roleHeader || altRoleHeader;
        return this.authService.authLogin(tenantId, body.username, body.password, requestedRole);
    }

    @Post('forget-password')
    authForgotPassword(
        @Headers('x-tenant-id') tenantId: string,
        @Body() dto: ForgetPasswordDto,
    ) {
        return this.authService.forgetPassword(tenantId, dto);
    }

    @Post('reset-password-otp')
    authResetPasswordOtp(
        @Headers('x-tenant-id') tenantId: string,
        @Body() dto: ResetPasswordOtpDto,
    ) {
        return this.authService.resetPasswordOtp(tenantId, dto);
    }  
}