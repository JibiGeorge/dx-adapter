import { Inject, Injectable } from "@nestjs/common";
import { HttpService } from "../../../common/http/http.service";
import { LoggingService } from "../../../common/logging/logging.service";

@Injectable()
export class BankApiService {
    constructor(
        private readonly httpService: HttpService,
        private readonly logger: LoggingService,
    ) { }

    async getBankAccounts(baseUrl: string, baseApiKey: string, entityId: number, tenantId: string) {
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/Api/v3/FetchAccountDetails`;

        this.logger.debug('Calling external FetchAccountDetails API', BankApiService.name, {
            endpoint,
            entityId,
        });

        const payload = {
            entityId: Math.min(entityId, 2147483647),
            entityType: 'BenefId',
            dbType: 'MA',
        };

        const response = await this.httpService.post<any>(endpoint, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-CA-SHARED-KEY': baseApiKey,
                'Payer': tenantId,
            },
        });

        if(!response.isSuccess) {
            this.logger.warn('Failed response from FetchAccountDetails API', BankApiService.name, {
                tenantId,
                endpoint,
                response,
            });
            throw new Error(response?.message || 'Failed to fetch bank accounts');
        }

        return response;
    }
}
