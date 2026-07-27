export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RefreshLease {
  owner: string;
  expiresAt: number;
}

export type RefreshFailureKind = "invalid" | "transient";

const INVALID_REFRESH_CODES = new Set([
  "invalid_refresh_token",
  "refresh_token_expired",
  "refresh_token_reused",
]);

/** Only explicit server revocation responses may destroy a stored session. */
export function classifyRefreshFailure(
  status: number,
  code: string | null,
): RefreshFailureKind {
  return (status === 400 || status === 401) &&
    code !== null &&
    INVALID_REFRESH_CODES.has(code)
    ? "invalid"
    : "transient";
}

export function removeStorageValueIfCurrent(
  storage: StorageLike,
  key: string,
  expected: string,
): boolean {
  if (storage.getItem(key) !== expected) return false;
  storage.removeItem(key);
  return true;
}

export function replaceStorageValueIfCurrent(
  storage: StorageLike,
  key: string,
  expected: string,
  replacement: string,
): boolean {
  const current = storage.getItem(key);
  if (current === replacement) return true;
  if (current !== expected) return false;
  storage.setItem(key, replacement);
  return true;
}

export function parseRefreshLease(raw: string | null): RefreshLease | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RefreshLease>;
    if (
      typeof value.owner === "string" &&
      value.owner.length > 0 &&
      typeof value.expiresAt === "number" &&
      Number.isFinite(value.expiresAt)
    ) {
      return { owner: value.owner, expiresAt: value.expiresAt };
    }
  } catch {
    // A corrupt/stale lease is equivalent to no lease.
  }
  return null;
}

export interface RefreshCoordinatorOptions {
  lockName: string;
  leaseKey: string;
  channelName: string;
  watchedStorageKeys: readonly string[];
}

// Longer than the refresh fetch timeout, so background timer throttling alone
// cannot expire a live owner before its request is aborted.
const LEASE_TTL_MS = 20_000;
const LEASE_HEARTBEAT_MS = 5_000;

/**
 * Cross-tab refresh serialization. Web Locks is authoritative when available.
 * The localStorage lease is a best-effort fallback for older browsers; owner
 * verification, expiry, storage/channel wakeups and jitter narrow acquisition
 * races, while the server-side rotation grace remains the final backstop.
 */
export class RefreshCoordinator {
  private readonly owner = crypto.randomUUID();
  private readonly channel: BroadcastChannel | null;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly storage: StorageLike,
    private readonly options: RefreshCoordinatorOptions,
  ) {
    this.channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(options.channelName);
    this.channel?.addEventListener(
      "message",
      (event: MessageEvent<unknown>) => {
        this.wakeWaiters();
        for (const listener of this.messageListeners) listener(event.data);
      },
    );
    window.addEventListener("storage", (event) => {
      if (
        event.key === options.leaseKey ||
        (event.key !== null && options.watchedStorageKeys.includes(event.key))
      ) {
        this.wakeWaiters();
      }
    });
  }

  subscribe(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  publish(message: unknown): void {
    this.channel?.postMessage(message);
    this.wakeWaiters();
  }

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    if (navigator.locks) {
      return navigator.locks.request(this.options.lockName, task);
    }
    return this.runWithStorageLease(task);
  }

  private async runWithStorageLease<T>(task: () => Promise<T>): Promise<T> {
    for (;;) {
      const now = Date.now();
      const lease = parseRefreshLease(
        this.storage.getItem(this.options.leaseKey),
      );
      if (!lease || lease.expiresAt <= now) {
        const candidate: RefreshLease = {
          owner: this.owner,
          expiresAt: now + LEASE_TTL_MS,
        };
        this.storage.setItem(this.options.leaseKey, JSON.stringify(candidate));

        // localStorage has no CAS. Jitter plus read-back prevents the common
        // two-tab read-empty/write race from immediately producing two owners.
        await delay(randomBetween(35, 95));
        const confirmed = parseRefreshLease(
          this.storage.getItem(this.options.leaseKey),
        );
        if (confirmed?.owner === this.owner) {
          return this.runAsLeaseOwner(task);
        }
      }

      await this.waitForSignal(randomBetween(60, 180));
    }
  }

  private async runAsLeaseOwner<T>(task: () => Promise<T>): Promise<T> {
    const heartbeat = window.setInterval(() => {
      const lease = parseRefreshLease(
        this.storage.getItem(this.options.leaseKey),
      );
      if (lease?.owner !== this.owner) {
        window.clearInterval(heartbeat);
        return;
      }
      this.storage.setItem(
        this.options.leaseKey,
        JSON.stringify({
          owner: this.owner,
          expiresAt: Date.now() + LEASE_TTL_MS,
        } satisfies RefreshLease),
      );
    }, LEASE_HEARTBEAT_MS);

    try {
      return await task();
    } finally {
      window.clearInterval(heartbeat);
      const lease = parseRefreshLease(
        this.storage.getItem(this.options.leaseKey),
      );
      // Never remove a lease that a newer owner acquired after our expiry.
      if (lease?.owner === this.owner) {
        this.storage.removeItem(this.options.leaseKey);
      }
      this.publish({ type: "refresh-coordination-released" });
    }
  }

  private waitForSignal(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.waiters.delete(finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, timeoutMs);
      this.waiters.add(finish);
    });
  }

  private wakeWaiters(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
