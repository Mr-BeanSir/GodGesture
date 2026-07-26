<script setup lang="ts">
/**
 * 可录制的快捷键输入框。
 * - multiKeys=false:单主键(用于暂停快捷键 PauseHotkey)
 * - multiKeys=true :主键序列(用于 hotKey 命令的 keys[])
 * v-model: { modifiers: string[], keys: string[] }(跨平台键码名,小写)
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    modifiers: string[];
    keys: string[];
    multiKeys?: boolean;
  }>(),
  { multiKeys: false },
);
const emit = defineEmits<{
  (e: "update:modifiers", value: string[]): void;
  (e: "update:keys", value: string[]): void;
}>();

const { t } = useI18n();
const recording = ref(false);
const boxRef = ref<HTMLElement | null>(null);

const MOD_ORDER = ["ctrl", "shift", "alt", "meta"] as const;
const MOD_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  meta: "Win/Cmd",
};

function normalizeKey(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  if (key === " ") return "space";
  if (/^[a-zA-Z0-9]$/.test(key)) return key.toLowerCase();
  if (/^F\d{1,2}$/.test(key)) return key.toLowerCase();
  const map: Record<string, string> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Escape: "esc",
    Enter: "enter",
    Backspace: "backspace",
    Delete: "delete",
    Tab: "tab",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    Insert: "insert",
  };
  if (key in map) return map[key];
  if (key.length === 1) return key.toLowerCase();
  return null;
}

function eventModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey) mods.push("alt");
  if (e.metaKey) mods.push("meta");
  return mods;
}

function onKeydown(e: KeyboardEvent) {
  if (!recording.value) return;
  e.preventDefault();
  e.stopPropagation();
  const key = normalizeKey(e);
  if (!key) return; // 仅按下修饰键时等待主键
  const mods = eventModifiers(e);
  if (props.multiKeys) {
    // 序列模式:首个键确定修饰,后续键仅追加主键
    if (props.keys.length === 0) emit("update:modifiers", mods);
    emit("update:keys", [...props.keys, key]);
  } else {
    emit("update:modifiers", mods);
    emit("update:keys", [key]);
    stopRecording();
  }
}

function startRecording() {
  recording.value = true;
}
function stopRecording() {
  recording.value = false;
  boxRef.value?.blur();
}

function clearAll() {
  emit("update:modifiers", []);
  emit("update:keys", []);
}

const display = computed(() => {
  const mods = MOD_ORDER.filter((m) => props.modifiers.includes(m)).map((m) => MOD_LABELS[m]);
  const keys = props.keys.map((k) => (k.length === 1 ? k.toUpperCase() : k));
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
    >
      <span v-if="recording" class="hotkey-input__hint">{{ t("hotkey.recording") }}</span>
      <span v-else-if="display" class="hotkey-input__value">{{ display }}</span>
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
