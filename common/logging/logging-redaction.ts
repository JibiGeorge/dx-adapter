import { DEFAULT_SENSITIVE_KEYS } from './logging.constants.js';

const SENSITIVE_KEY_PATTERNS = DEFAULT_SENSITIVE_KEYS.map(
  (key) => new RegExp(`^${key.replace(/[-_]/g, '[-_]?')}$`, 'i'),
);

const BEARER_REGEX = /Bearer\s+([A-Za-z0-9_\-\.]+)/gi;
const CONNECTION_STRING_REGEX = /([a-z]+:\/\/[^:]+:)([^@]+)(@.+)/gi;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  for (const pattern of SENSITIVE_KEY_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }
  return DEFAULT_SENSITIVE_KEYS.some((sensitive) =>
    normalized.includes(sensitive.toLowerCase()),
  );
}

export function redactString(value: string): string {
  let result = value;
  if (BEARER_REGEX.test(result)) {
    result = result.replace(BEARER_REGEX, 'Bearer [REDACTED]');
  }
  if (CONNECTION_STRING_REGEX.test(result)) {
    result = result.replace(CONNECTION_STRING_REGEX, '$1[REDACTED]$3');
  }
  return result;
}

export function redact<T>(data: T, seen = new WeakSet<object>()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    return redactString(data) as unknown as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Date || data instanceof RegExp) {
    return data;
  }

  if (data instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: data.name,
      message: redactString(data.message),
      stack: data.stack ? redactString(data.stack) : undefined,
    };
    for (const [key, val] of Object.entries(data)) {
      if (isSensitiveKey(key)) {
        errorObj[key] = '[REDACTED]';
      } else {
        errorObj[key] = redact(val, seen);
      }
    }
    return errorObj as unknown as T;
  }

  if (seen.has(data as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => redact(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redact(value, seen);
    }
  }

  return result as unknown as T;
}
