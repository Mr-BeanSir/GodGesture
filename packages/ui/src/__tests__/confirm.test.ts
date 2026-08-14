import { afterEach, describe, expect, it } from "vitest";
import { useConfirmDialog } from "../confirm";

type ConfirmDialogWithSubmit = ReturnType<typeof useConfirmDialog> & {
  submitConfirm: () => Promise<void>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  useConfirmDialog().resolveConfirm(false);
});

describe("useConfirmDialog", () => {
  it("keeps an async confirmation busy until its action completes", async () => {
    const action = deferred<boolean>();
    const dialog = useConfirmDialog() as ConfirmDialogWithSubmit;
    const outcome = dialog.confirm({
      title: "Clear logs",
      message: "This cannot be undone.",
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
      variant: "danger",
      onConfirm: () => action.promise,
    });

    const submission = dialog.submitConfirm();

    expect(dialog.pending.value?.busy).toBe(true);

    action.resolve(true);
    await submission;

    await expect(outcome).resolves.toBe(true);
    expect(dialog.pending.value).toBeNull();
  });

  it("keeps the request open when its action reports failure", async () => {
    const dialog = useConfirmDialog() as ConfirmDialogWithSubmit;
    const outcome = dialog.confirm({
      title: "Clear logs",
      message: "This cannot be undone.",
      confirmLabel: "Clear",
      cancelLabel: "Cancel",
      onConfirm: async () => false,
    });

    await dialog.submitConfirm();

    expect(dialog.pending.value?.busy).toBe(false);
    expect(dialog.pending.value?.title).toBe("Clear logs");

    dialog.resolveConfirm(false);
    await expect(outcome).resolves.toBe(false);
  });
});
