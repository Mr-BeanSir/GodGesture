import { validateEnv } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/godgesture',
  JWT_SECRET: 'test-secret-that-is-long-enough',
};

describe('validateEnv network boundary', () => {
  it('本地默认仅监听回环且不信任转发头', () => {
    const env = validateEnv(BASE);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
  });

  it('生产单跳反代配置可显式启用', () => {
    const env = validateEnv({
      ...BASE,
      HOST: '0.0.0.0',
      TRUST_PROXY_HOPS: '1',
    });
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it('拒绝过宽的可信代理跳数', () => {
    expect(() => validateEnv({ ...BASE, TRUST_PROXY_HOPS: '3' })).toThrow(
      'TRUST_PROXY_HOPS',
    );
  });
});
