import { computed, ref } from "vue";

export type AppMessageKind = "info" | "success" | "warning" | "error";

export type AppMessageEntry = {
  id: string;
  kind: AppMessageKind;
  message: string;
  duration: number;
};

const messages = ref<AppMessageEntry[]>([]);
let sequence = 0;
const timers = new Map<string, number>();

export function useMessages() {
  return computed(() => messages.value);
}

export function pushMessage(input: {
  kind: AppMessageKind;
  message: string;
  duration?: number;
}): string {
  const id = `message-${++sequence}`;
  const entry: AppMessageEntry = {
    id,
    kind: input.kind,
    message: input.message,
    duration: input.duration ?? 3_000,
  };

  messages.value = [...messages.value, entry];
  if (entry.duration > 0) {
    const timer = window.setTimeout(() => {
      timers.delete(id);
      dismissMessage(id);
    }, entry.duration);
    timers.set(id, timer);
  }
  return id;
}

export function dismissMessage(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  messages.value = messages.value.filter((entry) => entry.id !== id);
}

export function clearMessages(): void {
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  messages.value = [];
}
