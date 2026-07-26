import { HttpException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitGuard } from './rate-limit.guard';
import type { RateLimitPolicy } from './rate-limit.decorator';

function httpContext(ip: string) {
  const headers = new Map<string, string>();
  const request = {
    ip,
    socket: { remoteAddress: ip },
  } as Request;
  const response = {
    setHeader: jest.fn((name: string, value: string) =>
      headers.set(name, value),
    ),
  } as unknown as Response;
  const context = {
    getType: () => 'http',
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

describe('RateLimitGuard', () => {
  const policy: RateLimitPolicy = { name: 'login', limit: 2, windowMs: 1_000 };
  let now: number;
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RateLimitGuard;

  beforeEach(() => {
    now = 10_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false)
        .mockReturnValue(policy),
    };
    guard = new RateLimitGuard(reflector as unknown as Reflector);
  });

  afterEach(() => jest.restoreAllMocks());

  function setPolicy(next: RateLimitPolicy = policy) {
    reflector.getAllAndOverride.mockImplementation((key: symbol) =>
      String(key).includes('skip-rate-limit') ? false : next,
    );
  }

  it('超过同一 IP 的额度后返回标准 429 与 Retry-After', () => {
    setPolicy();
    const { context, headers } = httpContext('203.0.113.10');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    let error: unknown;
    try {
      guard.canActivate(context);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toEqual({
      error: 'rate_limited',
    });
    expect(headers.get('Retry-After')).toBe('1');
    expect(headers.get('RateLimit-Remaining')).toBe('0');
  });

  it('不同客户端 IP 使用独立额度', () => {
    setPolicy({ name: 'login', limit: 1, windowMs: 1_000 });
    expect(guard.canActivate(httpContext('203.0.113.10').context)).toBe(true);
    expect(guard.canActivate(httpContext('203.0.113.11').context)).toBe(true);
  });

  it('窗口到期后恢复额度', () => {
    setPolicy({ name: 'login', limit: 1, windowMs: 1_000 });
    const { context } = httpContext('203.0.113.10');
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    now += 1_001;
    expect(guard.canActivate(context)).toBe(true);
  });

  it('显式跳过的健康检查不创建限流状态', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { context } = httpContext('203.0.113.10');
    for (let i = 0; i < 200; i += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });
});
