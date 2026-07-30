<script setup lang="ts">
/**
 * 手势意图编辑器:名称、助记符(可重录)、修饰、修饰立即执行、命令。
 * 直接编辑传入的意图对象(来自配置 store,变更即触发防抖保存)。
 */
import { useI18n } from "vue-i18n";
import { Delete } from "@element-plus/icons-vue";
import type { GestureIntent, GestureModifier } from "@godgesture/shared";
import MnemonicText from "./MnemonicText.vue";
import CommandEditor from "./CommandEditor.vue";

const props = defineProps<{ intent: GestureIntent }>();
const emit = defineEmits<{ (e: "reRecord"): void; (e: "delete"): void }>();

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
    <div class="intent-editor__summary">
      <div class="gg-field intent-editor__name-field">
        <label class="gg-field-label">{{ t("gestures.intentName") }}</label>
        <el-input v-model="intent.name" maxlength="64" />
      </div>

      <div class="gg-field intent-editor__trigger-field">
        <label class="gg-field-label">{{ t("gestures.colMnemonic") }}</label>
        <div class="intent-editor__mnemonic-row">
          <MnemonicText :gesture="intent.gesture" class="intent-editor__mnemonic" />
          <el-button size="small" @click="emit('reRecord')">{{ t("gestures.reRecord") }}</el-button>
          <el-tooltip :content="t('gestures.deleteIntent')">
            <el-button
              link
              type="danger"
              :icon="Delete"
              :aria-label="t('gestures.deleteIntent')"
              @click="emit('delete')"
            />
          </el-tooltip>
        </div>
      </div>

      <div class="gg-field intent-editor__modifier-field">
        <label class="gg-field-label">{{ t("gestures.modifier") }}</label>
        <el-select v-model="intent.gesture.modifier" @change="onModifierChange">
          <el-option
            v-for="m in MODIFIERS"
            :key="m"
            :label="t(`modifier.${m}`)"
            :value="m"
          />
        </el-select>
      </div>

      <label v-if="intent.gesture.modifier !== 'none'" class="intent-editor__execute">
        <span>{{ t("gestures.executeOnModifier") }}</span>
        <el-switch v-model="intent.executeOnModifier" />
      </label>
    </div>

    <div class="gg-field intent-editor__command">
      <label class="gg-field-label">{{ t("gestures.editorTitle") }}</label>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.intent-editor {
  display: grid;
  gap: 16px;
}
.intent-editor__summary {
  display: grid;
  grid-template-columns: minmax(180px, 1.35fr) minmax(150px, 1fr);
  gap: 12px 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.intent-editor__name-field {
  grid-column: 1;
}
.intent-editor__trigger-field {
  grid-column: 2;
  grid-row: 1 / span 2;
}
.intent-editor__modifier-field {
  grid-column: 1;
  max-width: 280px;
}
.intent-editor__mnemonic-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.intent-editor__mnemonic {
  font-size: 20px;
}
.intent-editor__execute {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  grid-column: 1;
  max-width: 280px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
@media (max-width: 760px) {
  .intent-editor__summary {
    grid-template-columns: 1fr;
  }
  .intent-editor__name-field,
  .intent-editor__trigger-field,
  .intent-editor__modifier-field,
  .intent-editor__execute {
    grid-column: 1;
    grid-row: auto;
    max-width: none;
  }
}
</style>
