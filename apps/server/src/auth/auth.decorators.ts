import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './jwt-auth.guard';

/** 取当前 JWT 的 userId(须配合 JwtAuthGuard) */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.auth!.userId;
  },
);

/** 取当前 JWT 的 deviceId(须配合 JwtAuthGuard) */
export const CurrentDevice = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.auth!.deviceId;
  },
);
