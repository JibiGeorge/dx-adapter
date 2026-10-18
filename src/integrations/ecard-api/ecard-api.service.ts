import { Injectable } from '@nestjs/common';
import { LoggingService } from '../../../common/logging/logging.service.js';
import { CoverageLetterRequest, EcardPdfRequest } from './ecard-api.types.js';

@Injectable()
export class EcardApiService {
  constructor(private readonly logger: LoggingService) {}

  async makeEcardRestCall<T = any>(
    path: string,
    body: any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<T> {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');
    const url = `${cleanUrl}/${cleanPath}`;

    this.logger.debug(`Making ecard API call to: ${url}`, EcardApiService.name, {
      url,
      tenantId,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': accessKey,
          'Payer': tenantId,
          'LoadArchive': 'false',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Ecard API call failed with status ${response.status}: ${errorText}`,
          undefined,
          EcardApiService.name,
          { url, tenantId, status: response.status },
        );
        throw new Error(`Ecard API call failed: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/pdf') || contentType.includes('octet-stream')) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return { rawPdfBuffer: buffer } as unknown as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`makeEcardRestCall error: ${err.message}`, EcardApiService.name, {
        url,
      });
      throw error;
    }
  }

  async getEcardPdf(
    request: EcardPdfRequest | any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<any> {
    return this.makeEcardRestCall<any>('/Test/downloadECard', request, baseUrl, accessKey, tenantId);
  }

  async getCoverageLetter(
    request: CoverageLetterRequest | any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<any> {
    return this.makeEcardRestCall<any>('/mwc/printCoverageLetter', request, baseUrl, accessKey, tenantId);
  }
}
