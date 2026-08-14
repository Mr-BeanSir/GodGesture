import { computed, ref } from "vue";

export type ToastKind = "info" | "success" | "warning" | "error";
export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
};

const toasts = ref<Toast[]>([]);
let sequence = 0;
const timers = new Map<string, number>();

export function useToasts() {
  return computed(() => toasts.value);
}

export function pushToast(input: { kind: ToastKind; message: string; duration?: number }): string {
  const id = `toast-${++sequence}`;
  const toast: Toast = { id, kind: input.kind, message: input.message, duration: input.duration ?? 4200 };
  toasts.value = [...toasts.value, toast];
  if (toast.duration > 0) {
    const timer = window.setTimeout(() => {
      timers.delete(id);
      dismissToast(id);
    }, toast.duration);
    timers.set(id, timer);
  }
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

export function clearToasts(): void {
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
  toasts.value = [];
}
