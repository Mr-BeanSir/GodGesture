import { ref } from "vue";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: "primary" | "danger";
  /**
   * Runs while the dialog remains open. Return true only after the confirmed
   * operation completed; false or a rejected promise lets the user retry.
   */
  onConfirm?: () => boolean | Promise<boolean>;
};

export type PendingConfirm = ConfirmRequest & { busy: boolean };

const pending = ref<PendingConfirm | null>(null);
let resolver: ((value: boolean) => void) | undefined;

export function useConfirmDialog() {
  function confirm(request: ConfirmRequest): Promise<boolean> {
    if (pending.value?.busy) return Promise.resolve(false);
    settle(false);
    pending.value = { ...request, busy: false };
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
    });
  }

  function resolveConfirm(value: boolean): void {
    if (pending.value?.busy) return;
    settle(value);
  }

  async function submitConfirm(): Promise<void> {
    const request = pending.value;
    if (!request || request.busy) return;
    if (!request.onConfirm) {
      settle(true);
      return;
    }

    pending.value = { ...request, busy: true };
    try {
      if (await request.onConfirm()) {
        settle(true);
        return;
      }
    } catch {
      // The caller owns user-facing error reporting and can leave the dialog
      // open for an explicit retry or cancellation.
    }
    if (pending.value) pending.value = { ...pending.value, busy: false };
  }

  function settle(value: boolean): void {
    const current = resolver;
    resolver = undefined;
    pending.value = null;
    current?.(value);
  }

  return { pending, confirm, resolveConfirm, submitConfirm };
}

export function usePendingConfirm() {
  return pending;
}
