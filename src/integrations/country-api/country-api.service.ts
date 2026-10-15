import { Injectable } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service.js';
import { LoggingService } from '../../../common/logging/logging.service.js';

@Injectable()
export class CountryApiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) {}

  async getCountries(
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<any> {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/GetCountryList`;

    this.logger.debug('Calling external GetCountryList API', CountryApiService.name, {
      endpoint,
      tenantId,
    });

    const payload = {
      dBType: 'MA',
    };

    const response = await this.httpService.post<any>(endpoint, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-CA-SHARED-KEY': accessKey,
        'Payer': tenantId,
      },
    });

    if (!response?.isSuccess) {
      this.logger.warn('Failed response from GetCountryList API', CountryApiService.name, {
        tenantId,
        endpoint,
        response,
      });
      throw new Error(response?.message || 'Failed to fetch countries');
    }

    return response;
  }
}