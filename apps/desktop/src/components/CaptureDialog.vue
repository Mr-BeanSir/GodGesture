<script setup lang="ts">
/**
 * 手势录制器对话框。
 * 打开时调用 capture_start,订阅 "gesture-captured" 事件实时刷新助记符;
 * 关闭 / 取消时调用 capture_cancel 并退订。识别到与现有意图冲突时给出覆盖提示。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type {
  GestureIntent,
  GestureSpec,
  StrokeDirection,
  TriggerButton,
} from "@godgesture/shared";
import { useBackend, type CapturedGesture } from "../api/backend";
import { gestureMnemonic, sameGesture } from "../utils/mnemonic";
import MnemonicText from "./MnemonicText.vue";

const props = defineProps<{
  modelValue: boolean;
  /** 当前作用域内的既有意图(用于冲突检测) */
  existingIntents: GestureIntent[];
  /** 重新录制时排除自身 */
  excludeId?: string;
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

const captured = ref<{ trigger: TriggerButton; strokes: StrokeDirection[] } | null>(null);
let unlisten: (() => void) | null = null;

const capturedSpec = computed<GestureSpec | null>(() =>
  captured.value
    ? { trigger: captured.value.trigger, strokes: captured.value.strokes, modifier: "none" }
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

function onCaptured(g: CapturedGesture) {
  captured.value = {
    trigger: g.trigger as TriggerButton,
    strokes: g.strokes as StrokeDirection[],
  };
}

async function start() {
  captured.value = null;
  unlisten = await backend.onGestureCaptured(onCaptured);
  await backend.captureStart();
}

async function stop() {
  try {
    await backend.captureCancel();
  } catch {
    /* ignore */
  }
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

async function restart() {
  await stop();
  await start();
}

function onConfirm() {
  const spec = capturedSpec.value;
  if (!spec) return;
  emit("confirm", { gesture: spec, overwriteId: conflict.value?.id ?? null });
  visible.value = false;
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void start();
    else void stop();
  },
);

onBeforeUnmount(() => void stop());
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('capture.title')"
    width="440px"
    align-center
    append-to-body
  >
    <div class="capture">
      <p class="capture__hint">
        {{ backend.isTauri ? t("capture.hint") : t("capture.hintMock") }}
      </p>

      <div class="capture__stage" :class="{ 'is-conflict': conflict }">
        <MnemonicText v-if="capturedSpec" :gesture="capturedSpec" class="capture__mnemonic" />
        <span v-else class="capture__waiting">{{ t("capture.waiting") }}</span>
      </div>

      <el-alert
        v-if="conflict"
        type="warning"
        :closable="false"
        show-icon
        :title="t('capture.conflictTitle')"
      >
        {{ t("capture.conflictMessage", { mnemonic: liveMnemonic, name: conflict.name }) }}
      </el-alert>
    </div>

    <template #footer>
      <el-button @click="restart">{{ t("capture.restart") }}</el-button>
      <el-button @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :disabled="!capturedSpec" @click="onConfirm">
        {{ conflict ? t("capture.overwrite") : t("common.ok") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.capture {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.capture__hint {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.capture__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  border: 1px dashed var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-light);
}
.capture__stage.is-conflict {
  border-color: var(--el-color-warning);
}
.capture__mnemonic {
  font-size: 32px;
}
.capture__waiting {
  color: var(--el-text-color-placeholder);
}
</style>
