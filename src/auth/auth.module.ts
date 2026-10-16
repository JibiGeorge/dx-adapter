import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TenantModule } from '../tenant/tenant.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
    imports: [
        TenantModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const secret = configService.get<string>('JWT_SECRET');

                if (!secret) {
                    throw new Error('JWT_SECRET is not configured');
                }

                return {
                    secret,
                    signOptions: {
                        expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '24h') as any,
                    },
                };
            },
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService],
    exports: [JwtModule, AuthService],
})
export class AuthModule { }
