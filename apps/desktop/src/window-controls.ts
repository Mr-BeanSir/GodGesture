import { getCurrentWindow } from "@tauri-apps/api/window";

export interface SettingsWindowControls {
  minimize(): Promise<void>;
  close(): Promise<void>;
}

export function minimizeSettingsWindow(
  target: SettingsWindowControls = getCurrentWindow(),
): Promise<void> {
  return target.minimize();
}

export function closeSettingsWindow(
  target: SettingsWindowControls = getCurrentWindow(),
): Promise<void> {
  return target.close();
}
