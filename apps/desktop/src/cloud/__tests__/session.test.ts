import { describe, expect, it, vi } from "vitest";
import type { MeResponse, TokenPairResponse } from "@godgesture/shared";
import { CloudApi } from "../api";
import { CloudError } from "../errors";
import { CloudSession, resolveApiOrigin } from "../session";

const ORIGIN = "https://api.example.test";
const DEVICE_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAIR_A: TokenPairResponse = {
  accessToken: "access-a",
  refreshToken: "refresh-a",
  accessTokenExpiresIn: 900,
};
const PAIR_B: TokenPairResponse = {
  accessToken: "access-b",
  refreshToken: "refresh-b",
  accessTokenExpiresIn: 900,
};
const USER: MeResponse = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "user@example.test",
  displayName: "",
  createdAt: "2026-07-28T00:00:00.000Z",
  linkedProviders: [],
  role: "user",
  emailVerified: true,
};

function makeBackend(initialToken: string | null = null) {
  let token = initialToken;
  return {
    accountCredentialGet: vi.fn(async () => token),
    accountCredentialSet: vi.fn(async (_origin: string, value: string) => {
      token = value;
    }),
    accountCredentialDelete: vi.fn(async () => {
      token = null;
    }),
    currentToken: () => token,
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function mockFetch(
  handler: (request: Request) => Promise<Response>,
): typeof globalThis.fetch {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(input, init)),
  ) as typeof globalThis.fetch;
}

describe("cloud session configuration", () => {
  it("accepts HTTPS and local development origins only", () => {
    expect(resolveApiOrigin("https://api.example.test/", false)).toBe(ORIGIN);
    expect(resolveApiOrigin("http://127.0.0.1:3000", false)).toBe(
      "http://127.0.0.1:3000",
    );
    expect(resolveApiOrigin("http://localhost:3000", false)).toBe(
      "http://localhost:3000",
    );
    expect(resolveApiOrigin("http://api.example.test", false)).toBeNull();
    expect(resolveApiOrigin("https://api.example.test/path", false)).toBeNull();
    expect(resolveApiOrigin(undefined, true)).toBe("http://127.0.0.1:3000");
    expect(resolveApiOrigin("", false)).toBeNull();
  });

  it("rejects construction without a safe configured origin", () => {
    expect(
      () =>
        new CloudSession({
          apiOrigin: "http://api.example.test",
          backend: makeBackend(),
          fetch: vi.fn(),
        }),
    ).toThrowError(expect.objectContaining({ code: "server_not_configured" }));
  });
});

describe("cloud session lifecycle", () => {
  it("persists a login pair before using its access token", async () => {
    const backend = makeBackend();
    const requests: Request[] = [];
    const fetchMock = mockFetch(async (request) => {
      requests.push(request);
      if (request.url.endsWith("/auth/login")) return json(PAIR_A);
      if (request.url.endsWith("/auth/me")) return json(USER);
      throw new Error(`unexpected request: ${request.url}`);
    });
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: fetchMock,
    });
    const api = new CloudApi(session);

    await api.login({
      email: "user@example.test",
      password: "correct horse battery staple",
      device: { name: "Workstation", platform: "windows", deviceKey: DEVICE_KEY },
    });
    await expect(api.me()).resolves.toEqual(USER);

    expect(backend.currentToken()).toBe("refresh-a");
    expect(requests[requests.length - 1]?.headers.get("Authorization")).toBe(
      "Bearer access-a",
    );
  });

  it("restores a saved session by rotating its refresh token", async () => {
    const backend = makeBackend("refresh-a");
    const fetchMock = mockFetch(async (request) => {
      expect(request.url).toBe(`${ORIGIN}/api/v1/auth/refresh`);
      expect(await request.json()).toEqual({ refreshToken: "refresh-a" });
      return json(PAIR_B);
    });
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: fetchMock,
    });

    await expect(session.restore()).resolves.toBe(true);
    expect(backend.currentToken()).toBe("refresh-b");
  });

  it("deduplicates concurrent refreshes and retries both authenticated requests", async () => {
    const backend = makeBackend();
    let refreshCalls = 0;
    const fetchMock = mockFetch(async (request) => {
      if (request.url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        await Promise.resolve();
        return json(PAIR_B);
      }
      if (request.url.endsWith("/auth/me")) {
        return request.headers.get("Authorization") === "Bearer access-b"
          ? json(USER)
          : json({ error: "invalid_access_token" }, 401);
      }
      throw new Error(`unexpected request: ${request.url}`);
    });
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: fetchMock,
    });
    const api = new CloudApi(session);
    await session.installTokenPair(PAIR_A);

    await expect(Promise.all([api.me(), api.me()])).resolves.toEqual([
      USER,
      USER,
    ]);
    expect(refreshCalls).toBe(1);
    expect(backend.currentToken()).toBe("refresh-b");
  });

  it("preserves a stored credential after a transient refresh failure", async () => {
    const backend = makeBackend("refresh-a");
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: mockFetch(async () => {
        throw new TypeError("offline");
      }),
    });

    await expect(session.restore()).rejects.toMatchObject({ code: "network" });
    expect(backend.currentToken()).toBe("refresh-a");
    expect(backend.accountCredentialDelete).not.toHaveBeenCalled();
  });

  it("clears an invalid saved credential and notifies session expiry", async () => {
    const backend = makeBackend("refresh-a");
    const expired = vi.fn();
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: mockFetch(async () =>
        json({ error: "refresh_token_expired" }, 401),
      ),
    });
    session.setExpiredHandler(expired);

    await expect(session.restore()).rejects.toMatchObject({
      status: 401,
      code: "session_expired",
    });
    expect(backend.currentToken()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("best-effort revokes a newly issued pair when credential storage fails", async () => {
    const backend = makeBackend();
    backend.accountCredentialSet.mockRejectedValueOnce({
      code: "credential_write_failed",
      message: "locked",
    });
    const requests: Request[] = [];
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: mockFetch(async (request) => {
        requests.push(request);
        if (request.url.endsWith("/auth/login")) return json(PAIR_A);
        if (request.url.endsWith("/auth/logout"))
          return new Response(null, { status: 204 });
        throw new Error(`unexpected request: ${request.url}`);
      }),
    });
    const api = new CloudApi(session);

    await expect(
      api.login({
        email: "user@example.test",
        password: "correct horse battery staple",
        device: { name: "Workstation", platform: "windows", deviceKey: DEVICE_KEY },
      }),
    ).rejects.toMatchObject({ code: "credential_write_failed" });

    const revoke = requests.find((request) =>
      request.url.endsWith("/auth/logout"),
    );
    expect(revoke?.headers.get("Authorization")).toBe("Bearer access-a");
    expect(backend.currentToken()).toBeNull();
  });

  it("rejects a malformed success response before it reaches account state", async () => {
    const backend = makeBackend();
    const session = new CloudSession({
      apiOrigin: ORIGIN,
      backend,
      fetch: mockFetch(async () => json({ accessToken: 42 }, 200)),
    });
    const api = new CloudApi(session);

    const error = await api
      .login({
        email: "user@example.test",
        password: "password",
        device: { name: "Workstation", platform: "windows", deviceKey: DEVICE_KEY },
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudError);
    expect(error).toMatchObject({ code: "invalid_server_response" });
  });
});
