import {
  ListSnapshotsResponse,
  PullConfigResponse,
  RestoreSnapshotResponse,
} from "@godgesture/shared";
import { apiRequest } from "./client";

export function pullConfig(): Promise<PullConfigResponse> {
  return apiRequest(PullConfigResponse, "/sync/config");
}

export function listSnapshots(): Promise<ListSnapshotsResponse> {
  return apiRequest(ListSnapshotsResponse, "/sync/snapshots");
}

export function restoreSnapshot(
  version: number,
): Promise<RestoreSnapshotResponse> {
  return apiRequest(
    RestoreSnapshotResponse,
    `/sync/snapshots/${version}/restore`,
    { method: "POST" },
  );
}
