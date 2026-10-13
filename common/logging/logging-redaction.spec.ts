import { isSensitiveKey, redact } from "./logging-redaction";

describe('logging-redaction', () => {
  describe('isSensitiveKey', () => {
    it.each([
      'authorization',
      'x-api-key',
      'api-key',
      'password',
      'secret',
      'token',
      'access_token',
      'refresh_token',
      'cookie',
    ])('should flag %s as sensitive', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each(['userId', 'name', 'status', 'message', 'durationMs'])(
      'should NOT flag %s as sensitive',
      (key) => {
        expect(isSensitiveKey(key)).toBe(false);
      },
    );
  });

  describe('redact', () => {
    it('should return primitives unchanged', () => {
      expect(redact(42)).toBe(42);
      expect(redact(true)).toBe(true);
      expect(redact(null)).toBeNull();
    });

    it('should redact sensitive fields in an object', () => {
      const result = redact({
        name: 'Test Tenant',
        password: 'hunter2',
        apiKey: 'abc123',
      });
      expect((result as any).name).toBe('Test Tenant');
      expect((result as any).password).toBe('[REDACTED]');
      expect((result as any).apiKey).toBe('[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const result = redact({
        config: {
          name: 'prod',
          db: {
            host: 'localhost',
            password: 'dbpass',
          },
        },
      }) as any;
      expect(result.config.name).toBe('prod');
      expect(result.config.db.password).toBe('[REDACTED]');
    });

    it('should redact sensitive fields in arrays', () => {
      const result = redact([
        { id: 1, secret: 'shh' },
        { id: 2, name: 'safe' },
      ]) as any[];
      expect(result[0].secret).toBe('[REDACTED]');
      expect(result[1].name).toBe('safe');
    });

    it('should handle circular references safely', () => {
      const obj: Record<string, any> = { id: 1 };
      obj.self = obj;
      expect(() => redact(obj)).not.toThrow();
      expect((redact(obj) as any).self).toBe('[CIRCULAR]');
    });

    it('should redact Bearer tokens from strings', () => {
      const result = redact('Authorization: Bearer supersecrettoken');
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('supersecrettoken');
    });

    it('should not modify Date or RegExp objects', () => {
      const d = new Date('2026-01-01');
      const r = /test/;
      expect(redact(d)).toBe(d);
      expect(redact(r)).toBe(r);
    });
  });
});
