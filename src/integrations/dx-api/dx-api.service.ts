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

    async searchNonCMSClaims(maids: number[], baseUrl: string, accessKey: string) {
        if (!maids || maids.length === 0) {
            return { isSuccess: true, claims: [] };
        }

        if (!baseUrl) {
            this.logger.error('DataExchange API base URL is not configured for searchNonCMSClaims', undefined, DXApiService.name);
            return { isSuccess: false, claims: [] };
        }

        // Batch MAIDs into chunks of 200 to prevent hitting API payload / SQL limits
        const BATCH_SIZE = 200;
        const chunks: number[][] = [];
        for (let i = 0; i < maids.length; i += BATCH_SIZE) {
            chunks.push(maids.slice(i, i + BATCH_SIZE));
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/memberportal/search/noncmsclaim/claims/`;

        this.logger.debug(
            `Calling NonCMS claims endpoint with ${maids.length} MAIDs in ${chunks.length} batches`,
            DXApiService.name,
            { endpoint, totalMaids: maids.length, batches: chunks.length },
        );

        const results = await Promise.all(
            chunks.map(async (chunk, idx) => {
                try {
                    const response = await this.httpService.post<any>(
                        endpoint,
                        { MaIds: chunk, IsDHSMember: false },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-Key': accessKey,
                            },
                        },
                    );

                    if (response && response.isSuccess === false) {
                        this.logger.warn(
                            `NonCMS claims batch ${idx + 1} returned unsuccessful`,
                            DXApiService.name,
                            { batch: idx + 1, response },
                        );
                        return [];
                    }

                    return (response?.claims || response?.Claims || []) as any[];
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    this.logger.error(
                        `NonCMS claims batch ${idx + 1} request error: ${error.message}`,
                        error.stack,
                        DXApiService.name,
                        { batch: idx + 1, endpoint },
                    );
                    return [];
                }
            })
        );

        const allClaims: any[] = [];
        for (const batch of results) {
            for (const claim of batch) {
                allClaims.push(claim);
            }
        }

        this.logger.debug(`NonCMS claims total retrieved: ${allClaims.length} claims`, DXApiService.name);
        return { isSuccess: true, claims: allClaims };
    }

    async claimDetailsByRefNo(baseUrl: string, accessKey: string, claimReferenceNumber: string) {
        if (!baseUrl) {
            this.logger.error('DataExchange API base URL is not configured for claimDetailsByRefNo', undefined, DXApiService.name);
            return { success: false, message: 'Could not load claim details.' };
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/memberportal/search/claimDetails`;

        this.logger.debug(
            `Calling NonCMS claims endpoint with ${claimReferenceNumber}`,
            DXApiService.name,
            { endpoint, claimReferenceNumber },
        );

        try {
            const response = await this.httpService.post<any>(
                endpoint,
                { clmReferenceNo: claimReferenceNumber },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': accessKey,
                    },
                },
            );

            if (response && response.isSuccess === false) {
                this.logger.warn(
                    `NonCMS claims endpoint with ${claimReferenceNumber} returned unsuccessful`,
                    DXApiService.name,
                    { endpoint, claimReferenceNumber, response },
                );
                return { success: false, message: 'Could not load claim details.' }
            }

            return response
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(
                `NonCMS claims endpoint with ${claimReferenceNumber} request error: ${err.message}`,
                err.stack,
                DXApiService.name,
                { endpoint, claimReferenceNumber },
            );
            return { success: false, message: 'Could not load claim details.' };
        }
    }

    async getEnrollments(
        baseUrl: string,
        apiKey: string,
        params: URLSearchParams,
    ): Promise<any> {
        if (!baseUrl) {
            this.logger.error('Enrollment API base URL is not configured', undefined, DXApiService.name);
            throw new Error('Enrollment API URL is not configured.');
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const queryStr = params.toString();
        const endpoint = `${cleanUrl}/api/broker/enrollments${queryStr ? `?${queryStr}` : ''}`;

        this.logger.debug('Calling Enrollment API', DXApiService.name, {
            endpoint,
            params: Object.fromEntries(params.entries()),
        });

        try {
            const response = await this.httpService.get<any>(endpoint, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                },
            });

            return response;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(
                `Enrollment API request error: ${err.message}`,
                err.stack,
                DXApiService.name,
                { endpoint },
            );
            throw err;
        }
    }

    async requestEnrollmentOperation(
        baseUrl: string,
        apiKey: string,
        payload: { ids: Array<string | number>; operation: string },
    ): Promise<any> {
        if (!baseUrl) {
            this.logger.error('Enrollment API base URL is not configured', undefined, DXApiService.name);
            throw new Error('Enrollment API URL is not configured.');
        }

        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanUrl}/api/broker/enrollments/request-operation`;

        this.logger.debug('Calling Enrollment request-operation API', DXApiService.name, {
            endpoint,
            payload,
        });

        try {
            const response = await this.httpService.put<any>(endpoint, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey,
                },
            });

            return response;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error(
                `Enrollment request-operation error: ${err.message}`,
                err.stack,
                DXApiService.name,
                { endpoint },
            );
            throw err;
        }
    }
}