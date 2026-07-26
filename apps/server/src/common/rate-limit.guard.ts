import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_POLICY,
  SKIP_RATE_LIMIT,
  type RateLimitPolicy,
} from './rate-limit.decorator';

const DEFAULT_POLICY: RateLimitPolicy = {
  name: 'global',
  limit: 120,
  windowMs: 60_000,
};
const MAX_BUCKETS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const skipped = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipped) return true;

    const policy =
      this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT_POLICY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_POLICY;
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    const key = `${policy.name}:${request.ip || request.socket.remoteAddress || 'unknown'}`;
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.ensureCapacity(now, key);
      bucket = { count: 0, resetAt: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, policy.limit - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    response.setHeader('RateLimit-Limit', String(policy.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader(
      'RateLimit-Reset',
      String(Math.ceil(bucket.resetAt / 1000)),
    );
    if (bucket.count > policy.limit) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        { error: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private ensureCapacity(now: number, incomingKey: string): void {
    if (this.buckets.has(incomingKey) || this.buckets.size < MAX_BUCKETS)
      return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size < MAX_BUCKETS) return;

    let earliestKey: string | null = null;
    let earliestReset = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt < earliestReset) {
        earliestKey = key;
        earliestReset = bucket.resetAt;
      }
    }
    if (earliestKey) this.buckets.delete(earliestKey);
  }
}
