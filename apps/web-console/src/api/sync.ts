import {
  ListSnapshotsQuery,
  ListSnapshotsResponse,
  ConfigIndexResponse,
  ConfigScopeResponse,
  PullConfigResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from "@godgesture/shared";
import type {
  ListSnapshotsQuery as ListSnapshotsQueryType,
  RestoreSnapshotRequest as RestoreSnapshotRequestType,
} from "@godgesture/shared";
import { apiRequest } from "./client";

export function pullConfig(): Promise<PullConfigResponse> {
  return apiRequest(PullConfigResponse, "/sync/config");
}

export function getConfigIndex(): Promise<ConfigIndexResponse> {
  return apiRequest(ConfigIndexResponse, "/sync/config/index");
}

export function getConfigScope(scope: string): Promise<ConfigScopeResponse> {
  return apiRequest(ConfigScopeResponse, `/sync/config/scope/${encodeURIComponent(scope)}`);
}

export function listSnapshots(
  query: ListSnapshotsQueryType,
): Promise<ListSnapshotsResponse> {
  const parsed = ListSnapshotsQuery.parse(query);
  return apiRequest(ListSnapshotsResponse, "/sync/snapshots", {
    query: parsed,
  });
}

export function restoreSnapshot(
  version: number,
  request: RestoreSnapshotRequestType,
): Promise<RestoreSnapshotResponse> {
  return apiRequest(
    RestoreSnapshotResponse,
    `/sync/snapshots/${version}/restore`,
    { method: "POST", body: RestoreSnapshotRequest.parse(request) },
  );
}
