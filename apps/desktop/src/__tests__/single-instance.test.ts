import { describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import {
  listenForSingleInstance,
  SINGLE_INSTANCE_EVENT,
} from "../single-instance";

describe("single instance notifications", () => {
  it("subscribes to the native duplicate-launch event", async () => {
    const notify = vi.fn();
    const unlisten = vi.fn();
    let handler: ((event: Event<void>) => void) | undefined;
    const listen = vi.fn(async (event: string, callback: (event: Event<void>) => void) => {
      expect(event).toBe(SINGLE_INSTANCE_EVENT);
      handler = callback;
      return unlisten;
    });

    await expect(listenForSingleInstance(notify, listen)).resolves.toBe(unlisten);
    handler?.({ event: SINGLE_INSTANCE_EVENT, id: 1, payload: undefined });
    expect(notify).toHaveBeenCalledOnce();
  });
});
