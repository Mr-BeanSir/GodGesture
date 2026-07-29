import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";

export const SINGLE_INSTANCE_EVENT = "single-instance-attempted";

type Listen = (event: string, handler: EventCallback<void>) => Promise<UnlistenFn>;

export async function listenForSingleInstance(
  notify: () => void,
  listenOverride?: Listen,
): Promise<UnlistenFn> {
  const listen =
    listenOverride ?? (await import("@tauri-apps/api/event")).listen;
  return listen(SINGLE_INSTANCE_EVENT, notify);
}
