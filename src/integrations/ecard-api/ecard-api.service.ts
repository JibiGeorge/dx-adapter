import { Injectable } from '@nestjs/common';
import { HttpService } from '../../../common/http/http.service.js';
import { LoggingService } from '../../../common/logging/logging.service.js';
import { CoverageLetterRequest, EcardPdfRequest } from './ecard-api.types.js';

@Injectable()
export class EcardApiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggingService,
  ) {}

  async makeEcardRestCall<T = any>(
    path: string,
    body: any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<T> {
    if (!baseUrl?.trim()) {
      this.logger.error('Ecard API base URL is not configured', undefined, EcardApiService.name, {
        path,
        tenantId,
      });
      throw new Error('Ecard API base URL is not configured.');
    }

    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const cleanPath = path.replace(/^\/+/, '');
    const endpoint = `${cleanUrl}/${cleanPath}`;

    this.logger.debug(`Making ecard API call to: ${endpoint}`, EcardApiService.name, {
      endpoint,
      path: cleanPath,
      tenantId,
      hasPayload: Boolean(body),
    });

    try {
      const response = await this.httpService.post<any>(endpoint, body, {
        tenantId,
        headers: {
          'Content-Type': 'application/json',
          'X-CA-SHARED-KEY': accessKey,
          'Payer': tenantId,
          'LoadArchive': 'false',
        },
      });

      if (Buffer.isBuffer(response)) {
        this.logger.debug(`Ecard API returned binary PDF stream of size ${response.length} bytes`, EcardApiService.name, {
          endpoint,
          tenantId,
          byteLength: response.length,
        });
        return { rawPdfBuffer: response } as unknown as T;
      }

      this.logger.debug('Ecard API response received successfully', EcardApiService.name, {
        endpoint,
        tenantId,
        hasData: Boolean(response),
      });

      return response as T;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `makeEcardRestCall error: ${err.message}`,
        err.stack,
        EcardApiService.name,
        { endpoint, tenantId, path: cleanPath },
      );
      throw err;
    }
  }

  async getEcardPdf(
    request: EcardPdfRequest | any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<any> {
    const payload: Record<string, any> = {
      printRequest: {
        executionMode: request?.printRequest?.executionMode || 'Single',
        identifierType: request?.printRequest?.identifierType || 'MemberId',
        identifierValue: String(request?.printRequest?.identifierValue || request?.maid || ''),
        printPattern: request?.printRequest?.printPattern || request?.printPattern || 'Family',
      },
      isPasswordEnabled: Boolean(request?.isPasswordEnabled ?? false),
      printExpiredPolicy: Boolean(request?.printExpiredPolicy ?? false),
      policyId: Number(request?.policyId || 0),
      insurerId: String(request?.insurerId ?? '10'),
      dbType: request?.dbType || 'MA',
      outputType: request?.outputType || 'PDFByteStream',
    };

    this.logger.debug('Fetching ecard PDF', EcardApiService.name, {
      baseUrl,
      tenantId,
      policyId: payload.policyId,
      memberId: payload.printRequest.identifierValue,
      printPattern: payload.printRequest.printPattern,
      insurerId: payload.insurerId,
      payload,
    });

    return this.makeEcardRestCall<any>('/Test/downloadECard', payload, baseUrl, accessKey, tenantId);
  }

  async getCoverageLetter(
    request: CoverageLetterRequest | any,
    baseUrl: string,
    accessKey: string,
    tenantId: string,
  ): Promise<any> {
    this.logger.debug('Fetching coverage letter', EcardApiService.name, {
      baseUrl,
      tenantId,
      memberPolicyId: request?.MemberPolicyId,
      pribenefId: request?.PribenefId,
      benefId: request?.BenefId,
      dbType: request?.DbType,
    });

    return this.makeEcardRestCall<any>('/mwc/printCoverageLetter', request, baseUrl, accessKey, tenantId);
  }
}

