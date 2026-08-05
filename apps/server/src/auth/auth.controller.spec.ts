import { RATE_LIMIT_POLICY, type RateLimitPolicy } from '../common/rate-limit.decorator';
import { AuthController } from './auth.controller';

function rateLimitFor(method: keyof AuthController): RateLimitPolicy {
  const handler = AuthController.prototype[method];
  return Reflect.getMetadata(RATE_LIMIT_POLICY, handler) as RateLimitPolicy;
}

describe('AuthController rate limits', () => {
  it('邮件验证码请求按 IP 限制为 3 分钟 5 次', () => {
    expect(rateLimitFor('requestRegistrationCode')).toEqual({
      name: 'email-verification',
      limit: 5,
      windowMs: 3 * 60 * 1000,
    });
    expect(rateLimitFor('requestPasswordReset')).toEqual({
      name: 'password-reset-request',
      limit: 5,
      windowMs: 3 * 60 * 1000,
    });
  });
});
