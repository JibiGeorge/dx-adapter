import { Injectable, Optional } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { TracerService } from '@nestjs/observe';
import {
  B3_TRACE_HEADER,
  CORRELATION_ID_HEADER,
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_HEADER,
  REQUEST_ID_REGEX,
  TRACEPARENT_HEADER,
} from './logging.constants.js';

export interface RequestContextData {
  requestId: string;
  traceId: string | null;
  tenantId: string | null;
  startTime: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextData>();

  constructor(
    @Optional()
    private readonly tracerService?: TracerService,
  ) {}

  run<T>(context: RequestContextData, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getStore(): RequestContextData | undefined {
    return this.storage.getStore();
  }

  getRequestId(): string | undefined {
    return this.getStore()?.requestId;
  }

  getTraceId(): string | undefined {
    const storeTraceId = this.getStore()?.traceId;
    if (storeTraceId) {
      return storeTraceId;
    }
    try {
      const observeTraceId = this.tracerService?.currentTraceId();
      if (observeTraceId) {
        return observeTraceId;
      }
    } catch {
      // In case Observe context is not initialized or throws
    }
    return undefined;
  }

  getTenantId(): string | undefined {
    return this.getStore()?.tenantId ?? undefined;
  }

  setTenantId(tenantId: string): void {
    const store = this.getStore();
    if (store && tenantId && typeof tenantId === 'string') {
      store.tenantId = tenantId.trim();
    }
  }

  setMetadata(key: string, value: unknown): void {
    const store = this.getStore();
    if (store) {
      store.metadata[key] = value;
    }
  }

  getMetadata(): Record<string, unknown> {
    return this.getStore()?.metadata ?? {};
  }

  sanitizeRequestId(headerValue?: string | string[]): string {
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (
      raw &&
      typeof raw === 'string' &&
      raw.length > 0 &&
      raw.length <= MAX_REQUEST_ID_LENGTH &&
      REQUEST_ID_REGEX.test(raw)
    ) {
      return raw;
    }
    return crypto.randomUUID();
  }

  extractTraceId(headers: Record<string, any>): string | null {
    // 1. Try active Observe TracerService
    try {
      const activeObserveTraceId = this.tracerService?.currentTraceId();
      if (activeObserveTraceId) {
        return activeObserveTraceId;
      }
    } catch {
      // Ignore if outside active span
    }

    // 2. Check W3C traceparent header (format: 00-{traceId}-{spanId}-{flags})
    const traceparent = headers[TRACEPARENT_HEADER] ?? headers['trace-parent'];
    if (typeof traceparent === 'string') {
      const parts = traceparent.split('-');
      if (parts.length >= 4 && parts[1] && parts[1].length === 32) {
        return parts[1];
      }
    }

    // 3. Check B3 trace header
    const b3Trace = headers[B3_TRACE_HEADER];
    if (typeof b3Trace === 'string' && b3Trace.length >= 16) {
      return b3Trace;
    }

    return null;
  }

  extractRequestId(headers: Record<string, any>): string {
    const candidate =
      headers[REQUEST_ID_HEADER] ??
      headers[CORRELATION_ID_HEADER] ??
      headers['x-correlationid'];
    return this.sanitizeRequestId(candidate);
  }
}
