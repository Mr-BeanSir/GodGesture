import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_POLICY = Symbol('rate-limit-policy');
export const SKIP_RATE_LIMIT = Symbol('skip-rate-limit');

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
}

export const RateLimit = (name: string, limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_POLICY, {
    name,
    limit,
    windowMs,
  } satisfies RateLimitPolicy);

export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);
