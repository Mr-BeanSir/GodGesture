import { describe, expect, it } from "vitest";
import {
  ListSnapshotsQuery,
  ListSnapshotsResponse,
  MAX_SNAPSHOT_PAGE_SIZE,
  RestoreSnapshotRequest,
  SnapshotMeta,
} from "../protocol.js";

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

describe("ListSnapshotsQuery", () => {
  it("applies bounded pagination defaults and coerces query strings", () => {
    expect(ListSnapshotsQuery.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(
      ListSnapshotsQuery.parse({ page: "2", pageSize: "50" }),
    ).toEqual({ page: 2, pageSize: 50 });
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: MAX_SNAPSHOT_PAGE_SIZE + 1 },
  ])("rejects invalid pagination: %j", (value) => {
    expect(() => ListSnapshotsQuery.parse(value)).toThrow();
  });
});

describe("ListSnapshotsResponse", () => {
  it("requires complete pagination metadata", () => {
    expect(
      ListSnapshotsResponse.parse({
        snapshots: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1,
      }),
    ).toEqual({
      snapshots: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    });
    expect(() => ListSnapshotsResponse.parse({ snapshots: [] })).toThrow();
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
