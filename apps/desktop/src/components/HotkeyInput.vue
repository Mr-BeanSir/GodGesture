<script setup lang="ts">
/**
 * 可录制的快捷键输入框。
 * - multiKeys=false:单主键(用于暂停快捷键 PauseHotkey)
 * - multiKeys=true :主键序列(用于 hotKey 命令的 keys[])
 * v-model: { modifiers: string[], keys: string[] }(跨平台键码名,小写)
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import {
  HOTKEY_MODIFIERS,
  type HotkeyKeyName,
  type HotkeyModifier,
} from "@godgesture/shared";
import {
  createHotkeyRecording,
  hotkeyRecordingDraft,
  recordHotkeyKeydown,
  recordHotkeyKeyup,
  type HotkeyChord,
  type HotkeyRecording,
} from "./hotkey-recorder";

const props = withDefaults(
  defineProps<{
    modifiers: string[];
    keys: string[];
    multiKeys?: boolean;
  }>(),
  { multiKeys: false },
);
const emit = defineEmits<{
  (e: "update:modifiers", value: HotkeyModifier[]): void;
  (e: "update:keys", value: HotkeyKeyName[]): void;
}>();

const { t } = useI18n();
const recording = ref(false);
const boxRef = ref<HTMLElement | null>(null);
const draft = ref<HotkeyChord | null>(null);
let recordingState: HotkeyRecording | null = null;

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
  if (e.code === "Escape") {
    stopRecording();
    return;
  }
  if (recordHotkeyKeydown(recordingState, e) === "unsupported") {
    ElMessage.warning(t("hotkey.unsupportedKey"));
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
    emit("update:modifiers", completed.modifiers);
    emit("update:keys", props.multiKeys ? completed.keys : completed.keys.slice(0, 1));
    stopRecording();
  }
}

function startRecording() {
  if (recording.value) return;
  recordingState = createHotkeyRecording();
  draft.value = { modifiers: [], keys: [] };
  recording.value = true;
}
function stopRecording() {
  recording.value = false;
  recordingState = null;
  draft.value = null;
  boxRef.value?.blur();
}

function clearAll() {
  emit("update:modifiers", []);
  emit("update:keys", []);
}

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
    <el-button link size="small" @click="clearAll">{{ t("hotkey.clear") }}</el-button>
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
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  cursor: pointer;
  font-size: 13px;
  line-height: 20px;
  user-select: none;
  transition: border-color 0.2s;
}
.hotkey-input__box:hover {
  border-color: var(--el-border-color-hover);
}
.hotkey-input__box.is-recording {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
.hotkey-input__hint {
  color: var(--el-text-color-placeholder);
}
.hotkey-input__value {
  font-weight: 600;
}
</style>
