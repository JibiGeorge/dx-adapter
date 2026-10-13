import { Body, Controller, Get, Headers } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthLoginDto } from "./dto/auth-login.dto";

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Get('login')
    authLogin(
        @Headers('x-tenant-id') id: string,
        @Body() body: AuthLoginDto,
    ) {
        return this.authService.authLogin(id, body.username, body.password);
    }
}