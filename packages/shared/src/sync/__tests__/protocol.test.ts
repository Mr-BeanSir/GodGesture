import { describe, expect, it } from "vitest";
import { RestoreSnapshotRequest } from "../protocol.js";

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
