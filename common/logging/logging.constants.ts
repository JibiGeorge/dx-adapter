export const LOG_LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  log: 3,
  debug: 4,
  verbose: 5,
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

export const DEFAULT_SENSITIVE_KEYS = [
  'authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'credential',
  'credentials',
  'connectionstring',
  'db',
  'dbname',
  'host',
  'port',
] as const;

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const TRACEPARENT_HEADER = 'traceparent';
export const B3_TRACE_HEADER = 'x-b3-traceid';

export const MAX_REQUEST_ID_LENGTH = 64;
export const REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-\.]+$/;
