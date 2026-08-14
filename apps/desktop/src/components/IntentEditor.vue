<script setup lang="ts">
/**
 * 手势意图编辑器:名称、助记符(可重录)、独立修饰符、命令。
 * 直接编辑传入的意图对象(来自配置 store,变更即触发防抖保存)。
 */
import { CircleHelp, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { AppButton } from "@godgesture/ui";
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
        <label class="gg-field-label" for="gesture-intent-name">{{ t("gestures.intentName") }}</label>
        <input id="gesture-intent-name" v-model="intent.name" class="gg-input" maxlength="64" />
      </div>

      <div class="gg-field intent-editor__trigger-field">
        <span class="gg-field-label">{{ t("gestures.colMnemonic") }}</span>
        <div class="intent-editor__trigger-stack">
          <MnemonicText :gesture="intent.gesture" class="intent-editor__mnemonic" />
          <div class="intent-editor__actions">
            <AppButton name="rerecord-gesture" size="sm" @click="emit('reRecord')">
              {{ t("gestures.reRecord") }}
            </AppButton>
            <button
              type="button"
              class="gg-icon-button intent-editor__delete"
              :aria-label="t('gestures.deleteIntent')"
              :title="t('gestures.deleteIntent')"
              @click="emit('delete')"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div class="gg-field intent-editor__modifier-field">
        <div class="intent-editor__modifier-label">
          <label class="gg-field-label" for="gesture-modifier">{{ t("gestures.modifier") }}</label>
          <span
            class="intent-editor__help-icon"
            role="img"
            :aria-label="t('gestures.modifierTooltip')"
            :title="t('gestures.modifierTooltip')"
          >
            <CircleHelp aria-hidden="true" />
          </span>
        </div>
        <select id="gesture-modifier" v-model="intent.gesture.modifier" class="gg-select intent-editor__modifier-select">
          <option
            v-for="modifier in modifierOptions"
            :key="modifier"
            :value="modifier"
            :disabled="isModifierDisabled(modifier)"
          >
            {{ t(`modifier.${modifier}`) }}
          </option>
        </select>
      </div>
    </div>

    <div class="gg-field intent-editor__command">
      <span class="gg-field-label">{{ t("gestures.editorTitle") }}</span>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.intent-editor { display: grid; min-width: 0; gap: 16px; }
.intent-editor__summary {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(180px, 1.35fr) minmax(150px, 1fr);
  gap: 12px 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--gg-border);
}
.intent-editor__summary > .gg-field,
.intent-editor > .gg-field { min-width: 0; }
.intent-editor__name-field { grid-column: 1; }
.intent-editor__trigger-field { grid-column: 2; grid-row: 1 / span 2; }
.intent-editor__trigger-stack { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 8px; }
.intent-editor__mnemonic { min-width: 0; max-width: 100%; font-size: 20px; overflow-wrap: anywhere; }
.intent-editor__actions { display: flex; align-items: center; gap: 8px; }
.intent-editor__delete { color: var(--gg-danger); }
.intent-editor__help-icon { display: inline-flex; color: var(--gg-text-muted); cursor: help; }
.intent-editor__help-icon :deep(svg) { width: 16px; height: 16px; }
.intent-editor__modifier-field { max-width: 280px; }
.intent-editor__modifier-label { display: flex; align-items: center; gap: 5px; }
.intent-editor__modifier-select { width: 100%; }
</style>
