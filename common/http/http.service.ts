import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LoggingService } from '../logging/logging.service.js';

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  tenantId?: string;
  signal?: AbortSignal;
  responseType?: 'json' | 'buffer';
}

const DEFAULT_TIMEOUT_MS = 10_000;

@Injectable()
export class HttpService {
  constructor(private readonly logger: LoggingService) {}

  async get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>('GET', url, undefined, options);
  }

  async post<T = unknown>(
    url: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', url, body, options);
  }

  async put<T = unknown>(
    url: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', url, body, options);
  }

  async patch<T = unknown>(
    url: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('PATCH', url, body, options);
  }

  async delete<T = unknown>(
    url: string,
    options?: HttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  private async request<T = unknown>(
    method: string,
    rawUrl: string,
    body?: unknown,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const tenantId = options?.tenantId;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const resolvedUrl = this.buildUrl(rawUrl, options?.params);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options?.headers,
    };

    let serializedBody: string | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        serializedBody = body;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        serializedBody = JSON.stringify(body);
      }
    }

    const abortController = new AbortController();
    const timeoutTimer = setTimeout(() => abortController.abort(), timeoutMs);

    if (options?.signal) {
      options.signal.addEventListener('abort', () => abortController.abort());
    }

    let response: Response;
    try {
      response = await fetch(resolvedUrl, {
        method,
        headers,
        body: serializedBody,
        signal: abortController.signal,
      });
    } catch (error: unknown) {
      clearTimeout(timeoutTimer);
      const isTimeout =
        abortController.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      const reason = isTimeout
        ? `Request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown network error';

      this.logger.error(
        `HTTP ${method} failed for ${resolvedUrl}${tenantId ? ` [tenant: ${tenantId}]` : ''}. Reason: ${reason}`,
      );

      throw new ServiceUnavailableException(
        'The upstream external service is temporarily unavailable.',
      );
    } finally {
      clearTimeout(timeoutTimer);
    }

    let responseData: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (
      options?.responseType === 'buffer' ||
      contentType.includes('application/pdf') ||
      contentType.includes('application/octet-stream')
    ) {
      responseData = Buffer.from(await response.arrayBuffer());
    } else if (contentType.includes('application/json')) {
      try {
        responseData = await response.json();
      } catch {
        this.logger.error(
          `Invalid JSON response from ${method} ${resolvedUrl}${tenantId ? ` [tenant: ${tenantId}]` : ''}. HTTP ${response.status}`,
        );
        throw new BadGatewayException('The upstream service returned an invalid JSON response.');
      }
    } else {
      const text = await response.text();
      try {
        responseData = JSON.parse(text);
      } catch {
        responseData = text;
      }
    }

    if (!response.ok) {
      const errorBody = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData ?? '');
      this.logger.error(
        `Upstream HTTP ${response.status} returned from ${method} ${resolvedUrl}${tenantId ? ` [tenant: ${tenantId}]` : ''}. Error body: ${errorBody}`,
      );
      throw new BadGatewayException(`The upstream service returned HTTP ${response.status}: ${errorBody || response.statusText}`);
    }

    return responseData as T;
  }

  private buildUrl(
    baseUrl: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    const [urlPath, existingQuery] = baseUrl.split('?');
    const searchParams = new URLSearchParams(existingQuery || '');

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `${urlPath}?${queryString}` : urlPath;
  }
}
