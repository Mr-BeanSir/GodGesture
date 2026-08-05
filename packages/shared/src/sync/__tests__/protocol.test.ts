import { describe, expect, it } from "vitest";
import { RestoreSnapshotRequest, SnapshotMeta } from "../protocol.js";

describe("SnapshotMeta", () => {
  it("defaults a missing note for snapshots created by older servers", () => {
    expect(
      SnapshotMeta.parse({
        version: 1,
        createdAt: "2026-08-03T00:00:00.000Z",
        deviceId: null,
        deviceName: null,
        sizeBytes: 12,
      }).note,
    ).toBe("");
  });
});

describe("RestoreSnapshotRequest", () => {
  it("accepts the current nonnegative integer base version", () => {
    expect(RestoreSnapshotRequest.parse({ baseVersion: 0 })).toEqual({
      baseVersion: 0,
    });
    expect(RestoreSnapshotRequest.parse({ baseVersion: 42 })).toEqual({
      baseVersion: 42,
    });
  });

  it.each([
    {},
    { baseVersion: -1 },
    { baseVersion: 1.5 },
    { baseVersion: "4" },
  ])("rejects an invalid base version: %j", (value) => {
    expect(() => RestoreSnapshotRequest.parse(value)).toThrow();
  });
});
