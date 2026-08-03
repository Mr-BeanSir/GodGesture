<script setup lang="ts">
/**
 * 手势意图编辑器:名称、助记符(可重录)、独立修饰符、命令。
 * 直接编辑传入的意图对象(来自配置 store,变更即触发防抖保存)。
 */
import { useI18n } from "vue-i18n";
import { Delete, QuestionFilled } from "@element-plus/icons-vue";
import type { GestureIntent, GestureModifier } from "@godgesture/shared";
import MnemonicText from "./MnemonicText.vue";
import CommandEditor from "./CommandEditor.vue";
import { isModifierForTrigger } from "../utils/mnemonic";

const { intent } = defineProps<{ intent: GestureIntent }>();
const emit = defineEmits<{ (e: "reRecord"): void; (e: "delete"): void }>();

const { t } = useI18n();

const modifierOptions: GestureModifier[] = [
  "none",
  "wheelForward",
  "wheelBackward",
  "leftButtonDown",
  "middleButtonDown",
  "rightButtonDown",
  "x1Down",
  "x2Down",
];

function isModifierDisabled(modifier: GestureModifier): boolean {
  return isModifierForTrigger(intent.gesture.trigger, modifier);
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
        <div class="intent-editor__trigger-stack">
          <MnemonicText :gesture="intent.gesture" class="intent-editor__mnemonic" />
          <div class="intent-editor__actions">
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
      </div>

      <div class="gg-field intent-editor__modifier-field">
        <div class="intent-editor__modifier-label">
          <label class="gg-field-label" for="gesture-modifier">{{ t("gestures.modifier") }}</label>
          <el-tooltip :content="t('gestures.modifierTooltip')" placement="top">
            <el-icon :aria-label="t('gestures.modifierTooltip')"><QuestionFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-select id="gesture-modifier" v-model="intent.gesture.modifier" class="intent-editor__modifier-select">
          <el-option
            v-for="modifier in modifierOptions"
            :key="modifier"
            :label="t(`modifier.${modifier}`)"
            :value="modifier"
            :disabled="isModifierDisabled(modifier)"
          />
        </el-select>
      </div>
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
  min-width: 0;
  gap: 16px;
}
.intent-editor__summary {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(180px, 1.35fr) minmax(150px, 1fr);
  gap: 12px 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.intent-editor__summary > .gg-field,
.intent-editor > .gg-field {
  min-width: 0;
}
.intent-editor__name-field {
  grid-column: 1;
}
.intent-editor__trigger-field {
  grid-column: 2;
  grid-row: 1 / span 2;
}
.intent-editor__trigger-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.intent-editor__mnemonic {
  min-width: 0;
  max-width: 100%;
  font-size: 20px;
  overflow-wrap: anywhere;
}
.intent-editor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.intent-editor__modifier-field {
  max-width: 280px;
}
.intent-editor__modifier-label {
  display: flex;
  align-items: center;
  color: var(--el-text-color-regular);
  gap: 5px;
}
.intent-editor__modifier-label .el-icon {
  color: var(--el-text-color-placeholder);
  cursor: help;
}
.intent-editor__modifier-select {
  width: 100%;
}
@media (max-width: 760px) {
  .intent-editor__summary {
    grid-template-columns: 1fr;
  }
  .intent-editor__name-field,
  .intent-editor__trigger-field,
  .intent-editor__modifier-field {
    grid-column: 1;
    grid-row: auto;
    max-width: none;
  }
}
</style>
