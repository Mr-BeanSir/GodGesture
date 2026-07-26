import { randomBytes } from 'node:crypto';

/**
 * 进程内一次性凭据表(TTL + 用后即焚)。
 * 单实例部署(ADR-0004)下够用;若未来多实例,换 PG/Redis 存储即可。
 */
export class OneTimeStore<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  /** 生成不可猜测的键并存入 */
  put(value: T): string {
    this.prune();
    const key = randomBytes(24).toString('base64url');
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return key;
  }

  /** 取出并删除;不存在或已过期返回 null */
  consume(key: string): T | null {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
