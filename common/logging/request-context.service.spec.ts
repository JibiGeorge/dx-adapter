import { RequestContextService } from "./request-context.service";

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return undefined outside of context', () => {
    expect(service.getRequestId()).toBeUndefined();
    expect(service.getTraceId()).toBeUndefined();
    expect(service.getTenantId()).toBeUndefined();
  });

  it('should expose requestId inside a run() context', (done) => {
    const ctx = {
      requestId: 'req-abc-123',
      traceId: null,
      tenantId: null,
      startTime: Date.now(),
      metadata: {},
    };

    service.run(ctx, () => {
      expect(service.getRequestId()).toBe('req-abc-123');
      done();
    });
  });

  it('should isolate context between concurrent requests', async () => {
    const results: string[] = [];

    const run1 = new Promise<void>((resolve) => {
      const ctx1 = {
        requestId: 'req-1',
        traceId: null,
        tenantId: null,
        startTime: Date.now(),
        metadata: {},
      };
      service.run(ctx1, () => {
        setTimeout(() => {
          results.push(service.getRequestId()!);
          resolve();
        }, 10);
      });
    });

    const run2 = new Promise<void>((resolve) => {
      const ctx2 = {
        requestId: 'req-2',
        traceId: null,
        tenantId: null,
        startTime: Date.now(),
        metadata: {},
      };
      service.run(ctx2, () => {
        setTimeout(() => {
          results.push(service.getRequestId()!);
          resolve();
        }, 5);
      });
    });

    await Promise.all([run1, run2]);

    expect(results).toContain('req-1');
    expect(results).toContain('req-2');
    expect(results.length).toBe(2);
  });

  it('should set and get tenantId within context', (done) => {
    const ctx = {
      requestId: 'req-xyz',
      traceId: null,
      tenantId: null,
      startTime: Date.now(),
      metadata: {},
    };

    service.run(ctx, () => {
      service.setTenantId('tenant-MzA2N');
      expect(service.getTenantId()).toBe('tenant-MzA2N');
      done();
    });
  });

  it('should generate a valid UUID when no valid requestId header is provided', () => {
    const id = service.sanitizeRequestId(undefined);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should accept a valid external request ID', () => {
    const id = service.sanitizeRequestId('my-valid-req-123');
    expect(id).toBe('my-valid-req-123');
  });

  it('should reject a request ID that is too long and generate a new one', () => {
    const longId = 'a'.repeat(200);
    const id = service.sanitizeRequestId(longId);
    expect(id).not.toBe(longId);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('should reject a request ID with special characters', () => {
    const id = service.sanitizeRequestId('<script>alert(1)</script>');
    expect(id).not.toContain('<');
  });

  it('should extract traceId from W3C traceparent header', () => {
    const traceId = service.extractTraceId({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('should not expose tenantId outside its request context', async () => {
    const outerCtx = {
      requestId: 'outer-req',
      traceId: null,
      tenantId: null,
      startTime: Date.now(),
      metadata: {},
    };

    let innerTenantId: string | undefined;

    await new Promise<void>((resolve) => {
      service.run(outerCtx, () => {
        service.setTenantId('tenant-outer');

        // Simulate inner async context (different request)
        const innerCtx = {
          requestId: 'inner-req',
          traceId: null,
          tenantId: null,
          startTime: Date.now(),
          metadata: {},
        };
        service.run(innerCtx, () => {
          innerTenantId = service.getTenantId();
          resolve();
        });
      });
    });

    // Inner context should NOT see outer context's tenantId
    expect(innerTenantId).toBeNull();
  });
});
