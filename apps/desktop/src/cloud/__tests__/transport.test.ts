import { describe, expect, it } from "vitest";
import { apiData } from "../transport";

const stringValue = {
  safeParse(value: unknown) {
    return typeof value === "string"
      ? ({ success: true, data: value } as const)
      : ({ success: false, error: { issues: ["expected string"] } } as const);
  },
};

function result(response: Response, data?: unknown, error?: unknown) {
  return Promise.resolve({ response, data, error });
}

describe("cloud transport", () => {
  it("returns schema-validated success data", async () => {
    await expect(
      apiData(
        stringValue,
        result(new Response(null, { status: 200 }), "ok"),
        "/test",
      ),
    ).resolves.toBe("ok");
  });

  it("maps a typed HTTP error without discarding its status", async () => {
    await expect(
      apiData(
        stringValue,
        result(new Response(null, { status: 429 }), undefined, {
          error: "rate_limited",
        }),
        "/test",
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      endpoint: "/test",
    });
  });

  it("rejects a successful response that fails runtime validation", async () => {
    await expect(
      apiData(
        stringValue,
        result(new Response(null, { status: 200 }), 42),
        "/test",
      ),
    ).rejects.toMatchObject({
      status: 200,
      code: "invalid_server_response",
      endpoint: "/test",
    });
  });

  it("normalizes a rejected request as a network error", async () => {
    await expect(
      apiData(stringValue, Promise.reject(new TypeError("offline")), "/test"),
    ).rejects.toMatchObject({
      status: 0,
      code: "network",
      endpoint: "/test",
    });
  });
});
