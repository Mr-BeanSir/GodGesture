import { ListDevicesResponse } from "@godgesture/shared";
import { apiRequest, apiRequestVoid } from "./client";

export function listDevices(): Promise<ListDevicesResponse> {
  return apiRequest(ListDevicesResponse, "/devices");
}

export function renameDevice(id: string, name: string): Promise<void> {
  return apiRequestVoid(`/devices/${id}`, {
    method: "PATCH",
    body: { name },
  });
}

/** 踢下线(删除设备并撤销其全部刷新令牌);删当前设备等效登出 */
export function deleteDevice(id: string): Promise<void> {
  return apiRequestVoid(`/devices/${id}`, { method: "DELETE" });
}
