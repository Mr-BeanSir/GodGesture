import {
  AdminAccountStateRequest,
  AdminRoleRequest,
  AdminUserListResponse,
} from "@godgesture/shared";
import { apiRequest, apiRequestVoid } from "./client";

export function listAdminUsers(): Promise<AdminUserListResponse> {
  return apiRequest(AdminUserListResponse, "/admin/users");
}

export function setAdminUserState(
  id: string,
  input: AdminAccountStateRequest,
): Promise<void> {
  return apiRequestVoid("/admin/users/" + id + "/state", {
    method: "POST",
    body: input,
  });
}

export function setAdminUserRole(
  id: string,
  input: AdminRoleRequest,
): Promise<void> {
  return apiRequestVoid("/admin/users/" + id + "/role", {
    method: "POST",
    body: input,
  });
}

export function revokeAdminUserSessions(id: string): Promise<void> {
  return apiRequestVoid("/admin/users/" + id + "/revoke-sessions", {
    method: "POST",
  });
}
