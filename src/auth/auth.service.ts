import {
    BadGatewayException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { TenantConfigTypes } from '../tenant/tenant.types';
import { AuthResponse, ExternalLoginRequest } from './auth.types';
import { LoggingService } from '../../common/logging/logging.service';

const AUTH_API_TIMEOUT_MS = 10_000;
const APPLICATION_ID = '9240';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly tenantService: TenantService,
        private readonly loggingService: LoggingService,
    ) { }

    async authLogin(tenantId: string, username: string, password: string): Promise<AuthResponse> {
        // 1. Validate tenant identifier.
        if (!tenantId?.trim()) {
            throw new ServiceUnavailableException('Tenant identification is required.');
        }

        // 2. Load the full tenant configuration.
        let tenantConfig: TenantConfigTypes;

        try {
            tenantConfig = await this.tenantService.getFullTenantById(tenantId.trim());
        } catch (error: unknown) {
            this.loggingService.error(`Unable to load configuration for tenant: ${tenantId}`);
            throw error;
        }

        // 3. Validate the tenant's authentication API configuration.
        const authUrl = tenantConfig.apis?.authApi?.url;

        if (!authUrl) {
            this.loggingService.error(`Authentication API URL is missing for tenant: ${tenantId}`);

            throw new ServiceUnavailableException('Authentication service is not configured for this tenant.');
        }

        const endpoint = `${authUrl.replace(/\/+$/, '')}/SignIn/Password`;

        const payload: ExternalLoginRequest = {
            grant_type: '',
            username: username,
            password,
            applicationId: APPLICATION_ID,
            accesstoken: '',
            userAgent: '',
            emailId: '',
        };

        // 4. Call the external authentication API.
        let response: Response;

        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(AUTH_API_TIMEOUT_MS),
            });
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.name : 'UnknownError';

            this.loggingService.error(`Authentication API request failed for tenant ${tenantId}. Reason: ${reason}`,);

            throw new ServiceUnavailableException('The authentication service is temporarily unavailable.');
        }

        // 5. Parse the upstream response safely.
        let authData: unknown;

        try {
            authData = await response.json();
        } catch {
            this.loggingService.error(`Authentication API returned an invalid JSON response for tenant ${tenantId}. HTTP status: ${response.status}`);

            throw new BadGatewayException('The authentication service returned an invalid response.');
        }

        // 6. Handle upstream HTTP errors.
        if (!response.ok) {
            this.loggingService.error(`Authentication API returned HTTP ${response.status} for tenant ${tenantId}.`);

            // Do not expose upstream infrastructure errors or response bodies.
            throw new BadGatewayException('The authentication service could not process the request.');
        }

        // 7. Validate the response structure before trusting its fields.
        if (!this.isAuthResponse(authData)) {
            this.loggingService.error(`Authentication API returned an unexpected response structure for tenant ${tenantId}.`);

            throw new BadGatewayException('The authentication service returned an unexpected response.');
        }

        // 8. Log only non-sensitive outcome information.
        this.loggingService.debug(`Authentication request completed for tenant ${tenantId}. Success: ${authData.isSuccess}`);

        // Business-level login failures (for example, User_Not_Found)
        // are returned to the controller as normal AuthResponse values.
        return authData;
    }

    private isAuthResponse(value: unknown): value is AuthResponse {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const data = value as Record<string, unknown>;

        if (
            typeof data.userId !== 'number' ||
            typeof data.authenticated !== 'boolean' ||
            typeof data.isEmailVerified !== 'boolean' ||
            typeof data.isMobileVerified !== 'boolean' ||
            typeof data.isFirstLogin !== 'boolean' ||
            typeof data.isSuccess !== 'boolean'
        ) {
            return false;
        }

        if (data.isSuccess === false) {
            return (
                typeof data.errorMessage === 'string' &&
                typeof data.errorDescription === 'string'
            );
        }

        return (
            typeof data.username === 'string' &&
            typeof data.applicationId === 'string' &&
            typeof data.accessToken === 'object' &&
            data.accessToken !== null &&
            Array.isArray(data.roles) &&
            Array.isArray(data.features)
        );
    }
}