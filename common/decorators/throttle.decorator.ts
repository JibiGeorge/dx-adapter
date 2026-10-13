import { SetMetadata, applyDecorators } from '@nestjs/common';

export const THROTTLE_LIMIT_KEY = 'throttleLimit';
export const THROTTLE_TTL_KEY = 'throttleTtl';
export const SKIP_THROTTLE_KEY = 'skipThrottle';

export interface ThrottleOptions {
  limit: number;
  ttl: number; // in seconds
}

export const Throttle = (options: ThrottleOptions) =>
  applyDecorators(
    SetMetadata(THROTTLE_LIMIT_KEY, options.limit),
    SetMetadata(THROTTLE_TTL_KEY, options.ttl),
  );

export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);

