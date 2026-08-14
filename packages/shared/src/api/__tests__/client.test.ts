import { describe, expect, it, vi } from "vitest";
import { createGodGestureApiClient } from "../client.js";

const TOKEN_PAIR = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  accessTokenExpiresIn: 900,
};
const DEVICE_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("generated GodGesture API client", () => {
  it("serializes a public login request and parses its response", async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      Response.json(TOKEN_PAIR, { status: 200 }),
    );
    const client = createGodGestureApiClient({
      baseUrl: "https://api.example.test/api/v1",
      fetch: fetchMock,
    });

    const result = await client.POST("/auth/login", {
      body: {
        email: "user@example.test",
        password: "correct horse battery staple",
        device: { name: "Workstation", platform: "windows", deviceKey: DEVICE_KEY },
      },
    });

    expect(result.data).toEqual(TOKEN_PAIR);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.url).toBe("https://api.example.test/api/v1/auth/login");
    expect(request?.method).toBe("POST");
    await expect(request?.json()).resolves.toEqual({
      email: "user@example.test",
      password: "correct horse battery staple",
      device: { name: "Workstation", platform: "windows", deviceKey: DEVICE_KEY },
    });
  });

  it("serializes bearer headers and path parameters for a 204 response", async () => {
    const fetchMock = vi.fn(
      async (_request: Request) => new Response(null, { status: 204 }),
    );
    const client = createGodGestureApiClient({
      baseUrl: "https://api.example.test/api/v1",
      fetch: fetchMock,
      headers: { Authorization: "Bearer access-token" },
    });
    const deviceId = "7f95a398-3cc5-4c72-b827-69f0c7067c0c";

    const result = await client.DELETE("/devices/{id}", {
      params: { path: { id: deviceId } },
    });

    expect(result.data).toBeUndefined();
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.url).toBe(
      `https://api.example.test/api/v1/devices/${deviceId}`,
    );
    expect(request?.headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("returns the typed conflict body for a stale configuration push", async () => {
    const fetchMock = vi.fn(async (_request: Request) =>
      Response.json(
        { error: "version_conflict", serverVersion: 4 },
        { status: 409 },
      ),
    );
    const client = createGodGestureApiClient({
      baseUrl: "https://api.example.test/api/v1",
      fetch: fetchMock,
    });

    const result = await client.POST("/sync/snapshots/{version}/restore", {
      params: { path: { version: 2 } },
      body: { baseVersion: 3 },
    });

    expect(result.error).toEqual({
      error: "version_conflict",
      serverVersion: 4,
    });
  });
});
