import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ConfigDocument, type OAuthProvider } from "@godgesture/shared";
import { CloudError } from "../../cloud/errors";

const slots = vi.hoisted(() => ({
  backend: null as Record<string, unknown> | null,
  config: null as Record<string, unknown> | null,
  session: null as Record<string, unknown> | null,
  api: null as Record<string, unknown> | null,
  engines: [] as Array<Record<string, unknown>>,
  engineOptions: [] as unknown[],
  snapshotResponse: {
    snapshots: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  } as {
    snapshots: Array<Record<string, unknown>>;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  },
}));

vi.mock("../../api/backend", () => ({
  useBackend: () => slots.backend,
}));

vi.mock("../config", () => ({
  useConfigStore: () => slots.config,
}));

vi.mock("../../cloud/session", () => ({
  resolveApiOrigin: () => "https://cloud.example.test",
  CloudSession: class {
    setExpiredHandler(handler: () => void) {
      return (
        slots.session as ReturnType<typeof makeSession>
      ).setExpiredHandler(handler);
    }

    restore() {
      return (slots.session as ReturnType<typeof makeSession>).restore();
    }

    clearLocal() {
      return (slots.session as ReturnType<typeof makeSession>).clearLocal();
    }
  },
}));

vi.mock("../../cloud/api", () => ({
  CloudApi: class {
    providers() {
      return (slots.api as ReturnType<typeof makeApi>).providers();
    }

    me() {
      return (slots.api as ReturnType<typeof makeApi>).me();
    }

    login(input: unknown) {
      return (slots.api as ReturnType<typeof makeApi>).login(input);
    }

    register(input: unknown) {
      return (slots.api as ReturnType<typeof makeApi>).register(input);
    }

    exchangeOAuth(input: unknown) {
      return (slots.api as ReturnType<typeof makeApi>).exchangeOAuth(input);
    }

    authorizeUrl(
      provider: unknown,
      redirectUri: unknown,
      state: unknown,
      codeChallenge: unknown,
    ) {
      return (slots.api as ReturnType<typeof makeApi>).authorizeUrl(
        provider,
        redirectUri,
        state,
        codeChallenge,
      );
    }

    logoutRemote() {
      return (slots.api as ReturnType<typeof makeApi>).logoutRemote();
    }
  },
}));

vi.mock("../../cloud/oauth", () => ({
  createOAuthPkceAttempt: vi.fn(async () => ({
    verifier: "verifier",
    challenge: "challenge",
    state: "state",
  })),
  parseOAuthLoopbackResult: vi.fn(() => ({ code: "oauth-code", error: null })),
}));

vi.mock("../../cloud/sync-engine", () => ({
  CloudSyncEngine: class {
    constructor(options: unknown) {
      slots.engineOptions.push(options);
      const engine = {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        syncNow: vi.fn(async () => undefined),
        listSnapshots: vi.fn(async (_query: unknown) =>
          structuredClone(slots.snapshotResponse),
        ),
        restore: vi.fn(async () => undefined),
      };
      slots.engines.push(engine);
      return engine;
    }
  },
}));

import { useAccountStore } from "../account";

const USER = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "user@example.com",
  createdAt: "2026-07-28T12:00:00.000Z",
  linkedProviders: [] as const,
};
const DEVICE_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeBackend() {
  return {
    accountDeviceInfo: vi.fn(async () => ({
      name: "Test PC",
      platform: "windows" as const,
      deviceKey: DEVICE_KEY,
    })),
    oauthLoopbackStart: vi.fn(async () => ({
      attemptId: "attempt-1",
      redirectUri: "http://127.0.0.1:45678/oauth/callback",
    })),
    oauthLoopbackFinish: vi.fn(async () => ({
      code: "oauth-code",
      error: null,
    })),
    oauthLoopbackCancel: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
  };
}

function makeSession() {
  return {
    setExpiredHandler: vi.fn(),
    restore: vi.fn(async () => false),
    clearLocal: vi.fn(async () => undefined),
  };
}

function makeApi() {
  return {
    providers: vi.fn(async (): Promise<{ providers: OAuthProvider[] }> => ({
      providers: [],
    })),
    me: vi.fn(async () => USER),
    login: vi.fn(async (_input: unknown) => undefined),
    register: vi.fn(async (_input: unknown) => USER),
    exchangeOAuth: vi.fn(async (_input: unknown) => undefined),
    authorizeUrl: vi.fn(
      (
        _provider: unknown,
        _redirectUri: unknown,
        _state: unknown,
        _codeChallenge: unknown,
      ) => "https://cloud.example.test/api/v1/auth/oauth/github/authorize",
    ),
    logoutRemote: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  slots.engines = [];
  slots.engineOptions = [];
  slots.snapshotResponse = {
    snapshots: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  };
  slots.backend = makeBackend();
  slots.session = makeSession();
  slots.api = makeApi();
  slots.config = {
    ready: true,
    doc: ConfigDocument.parse({}),
    flushDocumentSaves: vi.fn(async () => ConfigDocument.parse({})),
    applySyncedDocument: vi.fn(async () => true),
  };
});

describe("account store startup", () => {
  it("starts signed out when no stored credential exists", async () => {
    const store = useAccountStore();

    await store.initialize();

    expect(store.phase).toBe("signedOut");
    expect(slots.engines).toHaveLength(0);
  });

  it("restores a session and starts synchronization", async () => {
    const session = slots.session as ReturnType<typeof makeSession>;
    session.restore.mockResolvedValueOnce(true);
    const store = useAccountStore();

    await store.initialize();

    expect(store.phase).toBe("signedIn");
    expect(store.user).toEqual(USER);
    expect(slots.engines).toHaveLength(1);
    expect(slots.engines[0].start).toHaveBeenCalledOnce();
  });

  it("keeps a recoverable session error after a transient restore failure", async () => {
    const session = slots.session as ReturnType<typeof makeSession>;
    session.restore.mockRejectedValueOnce(new CloudError(0, "network"));
    const store = useAccountStore();

    await store.initialize();

    expect(store.phase).toBe("sessionError");
    expect(store.authErrorCode).toBe("network");
    expect(session.clearLocal).not.toHaveBeenCalled();
  });

  it("loads snapshot page metadata after restoring a session", async () => {
    const session = slots.session as ReturnType<typeof makeSession>;
    session.restore.mockResolvedValueOnce(true);
    slots.snapshotResponse = {
      snapshots: [
        {
          version: 8,
          createdAt: "2026-08-06T08:00:00.000Z",
          deviceId: null,
          deviceName: null,
          note: "",
          sizeBytes: 512,
        },
      ],
      page: 2,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    };
    const store = useAccountStore();

    await store.initialize();
    await vi.waitFor(() => {
      expect(slots.engines[0].listSnapshots).toHaveBeenCalled();
    });

    expect(slots.engines[0].listSnapshots).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
    });
    expect(store.snapshots).toHaveLength(1);
    expect(store.snapshotsPage).toBe(2);
    expect(store.snapshotsPageSize).toBe(20);
    expect(store.snapshotsTotal).toBe(21);
    expect(store.snapshotsTotalPages).toBe(2);
  });
});

describe("account store authentication", () => {
  it("starts synchronization after password login", async () => {
    const api = slots.api as ReturnType<typeof makeApi>;
    const store = useAccountStore();
    await store.initialize();

    await store.loginWithPassword("user@example.com", "password-1");

    expect(api.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password-1",
      device: { name: "Test PC", platform: "windows", deviceKey: DEVICE_KEY },
    });
    expect(store.phase).toBe("signedIn");
    expect(slots.engines).toHaveLength(1);
  });

  it("clears the local session when remote logout is offline", async () => {
    const session = slots.session as ReturnType<typeof makeSession>;
    const api = slots.api as ReturnType<typeof makeApi>;
    session.restore.mockResolvedValueOnce(true);
    api.logoutRemote.mockRejectedValueOnce(new CloudError(0, "network"));
    const store = useAccountStore();
    await store.initialize();

    const outcome = await store.logout();

    expect(outcome).toBe("local_only");
    expect(session.clearLocal).toHaveBeenCalledOnce();
    expect(slots.engines[0].stop).toHaveBeenCalledOnce();
    expect(store.phase).toBe("signedOut");
  });

  it("allows OAuth only for a provider reported by the server", async () => {
    const backend = slots.backend as ReturnType<typeof makeBackend>;
    const api = slots.api as ReturnType<typeof makeApi>;
    api.providers.mockResolvedValue({ providers: ["github"] });
    const store = useAccountStore();
    await store.initialize();
    await store.loadProviders();

    await store.loginWithOAuth("google");
    expect(backend.oauthLoopbackStart).not.toHaveBeenCalled();

    await store.loginWithOAuth("github");
    expect(backend.oauthLoopbackStart).toHaveBeenCalledWith("state");
    expect(api.exchangeOAuth).toHaveBeenCalledWith({
      code: "oauth-code",
      codeVerifier: "verifier",
      device: { name: "Test PC", platform: "windows", deviceKey: DEVICE_KEY },
    });
    expect(store.phase).toBe("signedIn");
  });
});
