<script setup lang="ts">
/**
 * 手势意图编辑器:名称、助记符(可重录)、修饰、修饰立即执行、命令。
 * 直接编辑传入的意图对象(来自配置 store,变更即触发防抖保存)。
 */
import { useI18n } from "vue-i18n";
import type { GestureIntent, GestureModifier } from "@godgesture/shared";
import MnemonicText from "./MnemonicText.vue";
import CommandEditor from "./CommandEditor.vue";

const props = defineProps<{ intent: GestureIntent }>();
const emit = defineEmits<{ (e: "reRecord"): void }>();

const { t } = useI18n();

const MODIFIERS: GestureModifier[] = [
  "none",
  "wheelForward",
  "wheelBackward",
  "leftButtonDown",
  "middleButtonDown",
  "rightButtonDown",
  "x1Down",
  "x2Down",
];

function onModifierChange(value: GestureModifier) {
  if (value === "none") props.intent.executeOnModifier = false;
}
</script>

<template>
  <div class="intent-editor">
    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.intentName") }}</label>
      <el-input v-model="intent.name" maxlength="64" class="intent-editor__name" />
    </div>

    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.colMnemonic") }}</label>
      <div class="intent-editor__mnemonic-row">
        <MnemonicText :gesture="intent.gesture" class="intent-editor__mnemonic" />
        <el-button size="small" @click="emit('reRecord')">{{ t("gestures.reRecord") }}</el-button>
      </div>
    </div>

    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.modifier") }}</label>
      <el-select
        v-model="intent.gesture.modifier"
        class="intent-editor__modifier"
        @change="onModifierChange"
      >
        <el-option
          v-for="m in MODIFIERS"
          :key="m"
          :label="t(`modifier.${m}`)"
          :value="m"
        />
      </el-select>
    </div>

    <div v-if="intent.gesture.modifier !== 'none'" class="gg-switch-row">
      <el-switch v-model="intent.executeOnModifier" />
      <span>{{ t("gestures.executeOnModifier") }}</span>
    </div>

    <el-divider />

    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.editorTitle") }}</label>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.intent-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.intent-editor__name,
.intent-editor__modifier {
  max-width: 260px;
}
.intent-editor__mnemonic-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.intent-editor__mnemonic {
  font-size: 20px;
}
</style>
