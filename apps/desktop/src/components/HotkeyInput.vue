<script setup lang="ts">
/**
 * 可录制的快捷键输入框。
 * - multiKeys=false:单主键(用于暂停快捷键 PauseHotkey)
 * - multiKeys=true :主键序列(用于 hotKey 命令的 keys[])
 * v-model: { modifiers: string[], keys: string[] }(跨平台键码名,小写)
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AppButton, pushToast } from "@godgesture/ui";
import {
  HOTKEY_MODIFIERS,
} from "@godgesture/shared";
import {
  createHotkeyRecording,
  hotkeyRecordingDraft,
  recordHotkeyKeydown,
  recordHotkeyKeyup,
  type HotkeyChord,
  type HotkeyRecording,
} from "./hotkey-recorder";
import { useBackend, type HotkeyCaptureEvent } from "../api/backend";
import { appLog } from "../logging";

const props = withDefaults(
  defineProps<{
    modifiers: string[];
    keys: string[];
    multiKeys?: boolean;
  }>(),
  { multiKeys: false },
);
const emit = defineEmits<{
  /** 一次性提交完整和弦,避免父组件分别合并两个字段时丢失修饰键。 */
  (e: "complete", value: HotkeyChord): void;
}>();

const { t } = useI18n();
const backend = useBackend();
const recording = ref(false);
const boxRef = ref<HTMLElement | null>(null);
const draft = ref<HotkeyChord | null>(null);
let recordingState: HotkeyRecording | null = null;
let nativeCaptureRequested = false;
let nativeCaptureUnsubscribe: (() => void) | null = null;
let nativeCaptureToken = 0;

// WH_KEYBOARD_LL is currently implemented on Windows only. Browser preview
// and macOS intentionally keep using the WebView keyboard events.
const nativeCaptureSupported =
  backend.isTauri &&
  typeof navigator !== "undefined" &&
  /Windows|Win32|Win64/i.test(`${navigator.platform} ${navigator.userAgent}`);

const MOD_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  meta: typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Cmd" : "Win",
};

function onKeydown(e: KeyboardEvent) {
  if (!recording.value || !recordingState) return;
  e.preventDefault();
  e.stopPropagation();
  // The native hook is attempted before Windows-reserved shortcuts, while the
  // WebView path remains active as a fallback. Some system combinations may
  // still be handled by Windows before the application can retain focus.
  if (e.code === "Escape") {
    stopRecording();
    return;
  }
  if (recordHotkeyKeydown(recordingState, e) === "unsupported") {
    pushToast({ kind: "warning", message: t("hotkey.unsupportedKey") });
    return;
  }
  draft.value = hotkeyRecordingDraft(recordingState);
}

function onKeyup(e: KeyboardEvent) {
  if (!recording.value || !recordingState) return;
  e.preventDefault();
  e.stopPropagation();
  const completed = recordHotkeyKeyup(recordingState, e);
  if (completed) {
    emit("complete", {
      modifiers: completed.modifiers,
      keys: props.multiKeys ? completed.keys : completed.keys.slice(0, 1),
    });
    stopRecording();
  }
}

function onNativeCaptureEvent(event: HotkeyCaptureEvent) {
  if (!recording.value || !recordingState || !nativeCaptureRequested) return;
  if (event.code === "Escape" && event.pressed) {
    stopRecording();
    return;
  }
  if (event.pressed) {
    if (
      recordHotkeyKeydown(recordingState, {
        code: event.code,
        repeat: event.repeat,
      }) === "unsupported"
    ) {
      pushToast({ kind: "warning", message: t("hotkey.unsupportedKey") });
      return;
    }
    draft.value = hotkeyRecordingDraft(recordingState);
    return;
  }

  const completed = recordHotkeyKeyup(recordingState, {
    code: event.code,
    repeat: event.repeat,
  });
  if (!completed) return;
  emit("complete", {
    modifiers: completed.modifiers,
    keys: props.multiKeys ? completed.keys : completed.keys.slice(0, 1),
  });
  stopRecording();
}

async function enableNativeCapture(token: number) {
  if (!nativeCaptureSupported) return;
  let unsubscribe: (() => void) | null = null;
  try {
    // Subscribe before enabling the hook so the first Win keydown cannot be
    // swallowed without reaching the recorder.
    unsubscribe = await backend.onHotkeyCapture(onNativeCaptureEvent);
    if (token !== nativeCaptureToken || !recording.value) {
      unsubscribe();
      return;
    }
    nativeCaptureUnsubscribe = unsubscribe;
    // Start accepting native events before the IPC round trip completes so a
    // fast Win+W press cannot arrive in the gap between hook activation and
    // the invoke response.
    nativeCaptureRequested = true;
    await backend.hotkeyCaptureStart();
    if (token !== nativeCaptureToken || !recording.value) {
      await backend.hotkeyCaptureCancel();
    }
  } catch (error) {
    if (token !== nativeCaptureToken) return;
    // If native capture is unavailable, restore the WebView path so recording
    // remains usable in development builds and on systems without the hook.
    nativeCaptureRequested = false;
    nativeCaptureUnsubscribe?.();
    nativeCaptureUnsubscribe = null;
    appLog.warn("hotkey", `原生快捷键捕获不可用，回退到 WebView 事件: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function startRecording() {
  if (recording.value) return;
  recordingState = createHotkeyRecording();
  draft.value = { modifiers: [], keys: [] };
  recording.value = true;
  nativeCaptureRequested = false;
  const token = ++nativeCaptureToken;
  void enableNativeCapture(token);
}
function stopRecording() {
  ++nativeCaptureToken;
  const hadNativeCapture = nativeCaptureRequested || nativeCaptureUnsubscribe !== null;
  nativeCaptureRequested = false;
  const unsubscribe = nativeCaptureUnsubscribe;
  nativeCaptureUnsubscribe = null;
  if (hadNativeCapture) {
    void backend.hotkeyCaptureCancel().catch((error) =>
      appLog.warn("hotkey", `停止原生快捷键捕获失败: ${error instanceof Error ? error.message : String(error)}`),
    );
  }
  unsubscribe?.();
  recording.value = false;
  recordingState = null;
  draft.value = null;
  boxRef.value?.blur();
}

function clearAll() {
  emit("complete", { modifiers: [], keys: [] });
}

onBeforeUnmount(() => {
  if (recording.value || nativeCaptureRequested || nativeCaptureUnsubscribe) {
    stopRecording();
  }
});

const display = computed(() => {
  const value = recording.value && draft.value
    ? draft.value
    : { modifiers: props.modifiers, keys: props.keys };
  const mods = HOTKEY_MODIFIERS.filter((m) => value.modifiers.includes(m)).map(
    (m) => MOD_LABELS[m],
  );
  const keys = value.keys.map((k) => (k.length === 1 ? k.toUpperCase() : k));
  return [...mods, ...keys].join(" + ");
});
</script>

<template>
  <div class="hotkey-input">
    <div
      ref="boxRef"
      class="hotkey-input__box"
      :class="{ 'is-recording': recording }"
      tabindex="0"
      role="button"
      @focus="startRecording"
      @blur="stopRecording"
      @keydown="onKeydown"
      @keyup="onKeyup"
    >
      <span v-if="display" class="hotkey-input__value">{{ display }}</span>
      <span v-else-if="recording" class="hotkey-input__hint">{{ t("hotkey.recording") }}</span>
      <span v-else class="hotkey-input__hint">{{ t("hotkey.placeholder") }}</span>
    </div>
    <AppButton class="hotkey-input__clear" size="sm" variant="secondary" @click="clearAll">
      {{ t("hotkey.clear") }}
    </AppButton>
  </div>
</template>

<style scoped>
.hotkey-input {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.hotkey-input__box {
  min-width: 200px;
  padding: 5px 12px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
  color: var(--gg-text);
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
  user-select: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.hotkey-input__box:hover {
  border-color: var(--gg-border-strong);
}
.hotkey-input__box.is-recording {
  border-color: var(--gg-primary);
  box-shadow: 0 0 0 1px var(--gg-primary) inset;
}
.hotkey-input__hint {
  color: var(--gg-text-subtle);
}
.hotkey-input__value {
  font-weight: 600;
}
.hotkey-input__clear {
  flex: 0 0 auto;
}
</style>
