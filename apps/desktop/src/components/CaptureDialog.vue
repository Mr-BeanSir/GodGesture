<script setup lang="ts">
/**
 * 手势录制器对话框。
 * 打开时调用 capture_start,订阅 "gesture-captured" 事件实时刷新助记符;
 * 关闭 / 取消时调用 capture_cancel 并退订。识别到与现有意图冲突时给出覆盖提示。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { AppAlert, AppButton, AppDialog, AppSpinner, pushToast } from "@godgesture/ui";
import type {
  GestureInput,
  GestureIntent,
  GestureSpec,
  TriggerButton,
} from "@godgesture/shared";
import { useBackend, type CapturedGesture } from "../api/backend";
import { appLog } from "../logging";
import {
  gestureMnemonic,
  preservedModifierForInputs,
  sameGesture,
} from "../utils/mnemonic";
import MnemonicText from "./MnemonicText.vue";

const props = defineProps<{
  modelValue: boolean;
  /** 当前作用域内的既有意图(用于冲突检测) */
  existingIntents: GestureIntent[];
  /** 重新录制时排除自身 */
  excludeId?: string;
  /** 重新录制基础输入时保留已有独立修饰符 */
  preserveModifier?: GestureSpec["modifier"];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "confirm", payload: { gesture: GestureSpec; overwriteId: string | null }): void;
}>();

const { t } = useI18n();
const backend = useBackend();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const captured = ref<{
  trigger: TriggerButton;
  inputs: GestureInput[];
  modifier: GestureSpec["modifier"];
} | null>(null);
const cancelError = ref<string | null>(null);
const startError = ref<string | null>(null);
const lifecycleBusy = ref(false);

let unlisten: (() => void) | null = null;
let generation = 0;
let queuedOperations = 0;
let unmounted = false;
let lifecycle = Promise.resolve();

const capturedSpec = computed<GestureSpec | null>(() =>
  captured.value
    ? {
        trigger: captured.value.trigger,
        strokes: captured.value.inputs
          .filter(
            (input): input is Extract<GestureInput, { type: "stroke" }> =>
              input.type === "stroke",
          )
          .map((input) => input.direction),
        modifier: captured.value.modifier,
        inputs: captured.value.inputs,
      }
    : null,
);

const conflict = computed<GestureIntent | null>(() => {
  const spec = capturedSpec.value;
  if (!spec) return null;
  return (
    props.existingIntents.find(
      (i) => i.id !== props.excludeId && sameGesture(i.gesture, spec),
    ) ?? null
  );
});

const liveMnemonic = computed(() => (capturedSpec.value ? gestureMnemonic(capturedSpec.value) : ""));

function onCaptured(g: CapturedGesture, epoch: number) {
  if (unmounted || epoch !== generation || !props.modelValue) return;
  const inputs: GestureInput[] = g.inputs
    ? [...g.inputs]
    : [
        ...g.strokes.map((direction) => ({
          type: "stroke" as const,
          direction: direction as Extract<GestureInput, { type: "stroke" }>["direction"],
        })),
        ...(g.modifier === "wheelForward"
          ? [{ type: "wheel" as const, direction: "forward" as const }]
          : g.modifier === "wheelBackward"
            ? [{ type: "wheel" as const, direction: "backward" as const }]
            : g.modifier === "leftButtonDown"
              ? [{ type: "button" as const, button: "left" as const }]
              : g.modifier === "middleButtonDown"
                ? [{ type: "button" as const, button: "middle" as const }]
                : g.modifier === "rightButtonDown"
                  ? [{ type: "button" as const, button: "right" as const }]
                  : g.modifier === "x1Down"
                    ? [{ type: "button" as const, button: "x1" as const }]
                    : g.modifier === "x2Down"
                      ? [{ type: "button" as const, button: "x2" as const }]
                      : []),
      ];
  appLog.debug(
    "capture",
    `event=capture_payload_received inputCount=${inputs.length} hasKeyQ=${inputs.some((input) => input.type === "key" && input.key === "KeyQ")}`,
  );
  captured.value = {
    trigger: g.trigger as TriggerButton,
    inputs,
    modifier: preservedModifierForInputs(
      inputs,
      props.preserveModifier ?? "none",
    ),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function detachListener(listener: (() => void) | null = unlisten) {
  if (!listener) return;
  if (unlisten === listener) unlisten = null;
  try {
    listener();
  } catch (error) {
    // A failed unlisten must be observable, even though capture_cancel remains
    // the authoritative native cleanup below.
    startError.value = errorMessage(error);
    appLog.warn("capture", `移除手势录制监听失败: ${errorMessage(error)}`);
  }
}

async function cancelRecording(): Promise<boolean> {
  detachListener();
  try {
    await backend.captureCancel();
    cancelError.value = null;
    return true;
  } catch (error) {
    const wasPending = cancelError.value !== null;
    cancelError.value = errorMessage(error);
    appLog.error("capture", `取消手势录制失败: ${errorMessage(error)}`);
    if (!wasPending) pushToast({ kind: "error", message: t("capture.cancelError") });
    return false;
  }
}

function isCurrentOpen(epoch: number): boolean {
  return !unmounted && epoch === generation && props.modelValue;
}

async function start(epoch: number) {
  if (!isCurrentOpen(epoch)) return;

  captured.value = null;
  startError.value = null;

  // If a prior cancel failed, do not layer a new recording session over an
  // unknown native state. A later open/restart doubles as the retained retry.
  if (cancelError.value && !(await cancelRecording())) return;
  if (!isCurrentOpen(epoch)) return;

  let listener: (() => void) | null = null;
  try {
    listener = await backend.onGestureCaptured((gesture) => onCaptured(gesture, epoch));
    if (!isCurrentOpen(epoch)) {
      detachListener(listener);
      await cancelRecording();
      return;
    }
    unlisten = listener;

    await backend.captureStart();
    if (!isCurrentOpen(epoch)) {
      detachListener(listener);
      await cancelRecording();
    }
  } catch (error) {
    detachListener(listener);
    // capture_start may have reached Rust before its promise rejected. Always
    // issue the matching cancel so recording cannot remain stuck globally.
    await cancelRecording();
    startError.value = errorMessage(error);
    appLog.error("capture", `开始手势录制失败: ${errorMessage(error)}`);
  }
}

function enqueue(operation: () => Promise<void>): void {
  queuedOperations += 1;
  lifecycleBusy.value = true;
  const run = lifecycle.then(operation, operation).catch((error) => {
    startError.value = errorMessage(error);
    appLog.error("capture", `手势录制生命周期失败: ${errorMessage(error)}`);
  });
  lifecycle = run.finally(() => {
    queuedOperations -= 1;
    lifecycleBusy.value = queuedOperations > 0;
  });
}

function requestStart() {
  const epoch = ++generation;
  enqueue(() => start(epoch));
}

function requestStop() {
  ++generation;
  enqueue(async () => {
    await cancelRecording();
  });
}

function restart() {
  const epoch = ++generation;
  enqueue(async () => {
    const stopped = await cancelRecording();
    if (stopped && isCurrentOpen(epoch)) await start(epoch);
  });
}

function retryCleanup() {
  if (props.modelValue) requestStart();
  else requestStop();
}

function onConfirm() {
  const spec = capturedSpec.value;
  if (!spec) return;
  emit("confirm", { gesture: spec, overwriteId: conflict.value?.id ?? null });
  visible.value = false;
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open) requestStart();
    else if (wasOpen) requestStop();
  },
  { immediate: true },
);

function onVisibilityChange() {
  if (document.visibilityState === "hidden") requestStop();
  else if (props.modelValue) requestStart();
}

function onPageHide() {
  requestStop();
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", onPageHide);
  unmounted = true;
  requestStop();
});
</script>

<template>
  <AppDialog
    :open="visible"
    :title="t('capture.title')"
    :close-label="t('common.cancel')"
    :busy="lifecycleBusy"
    class="capture-dialog"
    @close="visible = false"
  >
    <div class="capture">
      <p class="capture__hint">
        {{ backend.isTauri ? t("capture.hint") : t("capture.hintMock") }}
      </p>

      <div class="capture__stage" :class="{ 'is-conflict': conflict }">
        <MnemonicText v-if="capturedSpec" :gesture="capturedSpec" class="capture__mnemonic" />
        <span v-else class="capture__waiting">{{ t("capture.waiting") }}</span>
      </div>

      <AppAlert
        v-if="conflict"
        variant="warning"
        :title="t('capture.conflictTitle')"
      >
        {{ t("capture.conflictMessage", { mnemonic: liveMnemonic, name: conflict.name }) }}
      </AppAlert>

      <AppAlert
        v-if="cancelError"
        variant="error"
        :title="t('capture.cancelError')"
      >
        <div class="capture__error-detail">{{ cancelError }}</div>
        <AppButton
          variant="quiet"
          size="sm"
          :loading="lifecycleBusy"
          :loading-label="t('capture.retryCleanup')"
          :aria-label="t('capture.retryCleanup')"
          @click="retryCleanup"
        >
          {{ t("capture.retryCleanup") }}
        </AppButton>
      </AppAlert>

      <AppAlert
        v-else-if="startError"
        variant="error"
        :title="t('capture.startError')"
      >
        {{ startError }}
      </AppAlert>
    </div>

    <template #footer>
      <AppSpinner v-if="lifecycleBusy" size="sm" :label="t('capture.waiting')" />
      <AppButton :disabled="lifecycleBusy" :aria-label="t('capture.restart')" @click="restart">
        {{ t("capture.restart") }}
      </AppButton>
      <AppButton :disabled="lifecycleBusy" :aria-label="t('common.cancel')" @click="visible = false">
        {{ t("common.cancel") }}
      </AppButton>
      <AppButton
        type="submit"
        variant="primary"
        :disabled="lifecycleBusy || !capturedSpec"
        :aria-label="conflict ? t('capture.overwrite') : t('common.ok')"
        @click="onConfirm"
      >
        {{ conflict ? t("capture.overwrite") : t("common.ok") }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.capture__hint {
  margin: 0;
  color: var(--gg-text-muted);
  font-size: 13px;
}
.capture__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  border: 1px dashed var(--gg-border-strong);
  border-radius: 6px;
  background: var(--gg-surface-muted);
}
.capture__stage.is-conflict {
  border-color: var(--gg-warning);
  background: var(--gg-warning-soft);
}
.capture__mnemonic {
  font-size: 32px;
}
.capture__waiting {
  color: var(--gg-text-muted);
}
.capture__error-detail {
  overflow-wrap: anywhere;
}
:deep(.gg-dialog.capture-dialog) { width: min(440px, calc(100vw - 32px)); }
</style>
