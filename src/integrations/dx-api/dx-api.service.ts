import { Injectable } from "@nestjs/common";
import { HttpService } from "../../../common/http/http.service.js";
import { LoggingService } from "../../../common/logging/logging.service.js";

@Injectable()
export class DXApiService {
    constructor(
        private readonly httpService: HttpService,
        private readonly logger: LoggingService,
    ) { }

    async getBeneficiaryDetailWithMaid(maid: string, baseUrl: string, accessKey: string) {
        if (!maid?.trim()) {
            return {
                status: 'error',
                success: false,
                data: {},
                message: 'No beneficiary id provided.',
            };
        }

        if (!baseUrl) {
            this.logger.error('DataExchange API base URL is not configured', undefined, DXApiService.name);
            return {
                status: 'error',
                success: false,
                data: {},
                message: 'DataExchange API URL is not configured.',
            };
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/api/beneficiaryinfo/getDetail/${encodeURIComponent(maid)}`;

        this.logger.debug('Calling external getDetail API', DXApiService.name, {
            endpoint,
            maid,
        });

        try {
            const response = await this.httpService.get<any>(endpoint, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': accessKey,
                },
            });

            this.logger.debug('Beneficiary detail API response received', DXApiService.name, {
                endpoint,
                maid,
                isSuccess: response?.isSuccess ?? response?.success,
            });

            if (response && response.isSuccess === false) {
                this.logger.warn('External API returned unsuccessful status', DXApiService.name, {
                    maid,
                    response,
                });
                return { success: false, message: response?.message || 'Unable to load beneficiary details.' };
            }

            return response;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(
                `Failed calling external beneficiary getDetail API: ${err.message}`,
                err.stack,
                DXApiService.name,
                { endpoint, maid },
            );
            return { success: false, message: 'Unable to load beneficiary details.' };
        }
    }

    async updateBeneficiary(baseUrl: string, accessKey: string, userDetails: Record<string, any>) {
        if (!baseUrl) {
            this.logger.error('DataExchange API base URL is not configured', undefined, DXApiService.name);
            return {
                status: 'error',
                success: false,
                message: 'DataExchange API URL is not configured.',
            };
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/api/beneficiaryinfo/update`;

        this.logger.debug('Calling external beneficiary update API', DXApiService.name, {
            endpoint,
            maid: userDetails?.maid,
        });

        try {
            const response = await this.httpService.post<any>(
                endpoint,
                {
                    UserDetails: userDetails,
                    userDetails: userDetails,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': accessKey,
                    },
                },
            );

            this.logger.debug('External beneficiary update API response received', DXApiService.name, {
                endpoint,
                maid: userDetails?.maid,
                isSuccess: response?.isSuccess ?? response?.success,
            });

            return response;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(
                `Failed calling external beneficiary update API: ${err.message}`,
                err.stack,
                DXApiService.name,
                { endpoint, maid: userDetails?.maid },
            );
            return {
                success: false,
                message: 'Unable to update beneficiary details. Please try again.',
            };
        }
    }
}