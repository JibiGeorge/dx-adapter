import { Injectable } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service.js';
import { LoggingService } from '../../../common/logging/logging.service.js';

@Injectable()
export class ProclaimApiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) {}

  async makeProclaimRestCall<T = any>(
    path: string,
    body: any,
    baseUrl: string,
    tenantId?: string,
  ): Promise<T> {
    if (!baseUrl?.trim()) {
      this.logger.error('Proclaim API base URL is not configured', undefined, ProclaimApiService.name, {
        path,
        tenantId,
      });
      throw new Error('Proclaim API base URL is not configured.');
    }

    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');
    const endpoint = `${cleanUrl}/${cleanPath}`;

    this.logger.debug(`Calling Proclaim API at: ${endpoint}`, ProclaimApiService.name, {
      endpoint,
      path: cleanPath,
      tenantId,
      hasPayload: Boolean(body),
    });

    try {
      const response = await this.httpService.post<T>(endpoint, body, {
        tenantId,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'Payer': tenantId } : {}),
        },
      });

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Proclaim API call failed for ${cleanPath}: ${err.message}`,
        err.stack,
        ProclaimApiService.name,
        { endpoint, tenantId },
      );
      throw err;
    }
  }

  async getPowerBIData(dashboardType: string, baseUrl: string, tenantId?: string): Promise<any> {
    return this.makeProclaimRestCall<any>(
      '/powerbidashboard/.json',
      { DashboardType: dashboardType },
      baseUrl,
      tenantId,
    );
  }

  async getProclaimUserToken(
    mediAuthUrl: string,
    credentials: { username: string; password: string },
    tenantId?: string,
  ): Promise<any> {
    const cleanUrl = mediAuthUrl.replace(/\/+$/, '');
    const endpoint = `${cleanUrl}/Proclaim/Token`;

    this.logger.debug(`Fetching Proclaim user token at: ${endpoint}`, ProclaimApiService.name, {
      endpoint,
      tenantId,
      username: credentials?.username,
    });

    try {
      const response = await this.httpService.post<any>(endpoint, credentials, {
        tenantId,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantId ? { 'Payer': tenantId } : {}),
        },
      });

      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to get proclaim token from ${endpoint}: ${err.message}`,
        err.stack,
        ProclaimApiService.name,
        { endpoint, tenantId },
      );
      throw err;
    }
  }
}
