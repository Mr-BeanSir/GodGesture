<script setup lang="ts">
import { Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { AppButton } from "@godgesture/ui";
import type { BoundaryIntent } from "@godgesture/shared";
import BoundaryMnemonic from "./BoundaryMnemonic.vue";
import CommandEditor from "./CommandEditor.vue";

defineProps<{ intent: BoundaryIntent }>();
const emit = defineEmits<{ (event: "reRecord"): void; (event: "delete"): void }>();
const { t } = useI18n();
</script>

<template>
  <div class="boundary-editor">
    <div class="boundary-editor__summary">
      <div class="gg-field">
        <label class="gg-field-label" for="boundary-intent-name">{{ t("gestures.intentName") }}</label>
        <input id="boundary-intent-name" v-model="intent.name" class="gg-input" maxlength="64" />
      </div>
      <div class="gg-field">
        <span class="gg-field-label">{{ t("gestures.colMnemonic") }}</span>
        <div class="boundary-editor__trigger-stack">
          <BoundaryMnemonic :intent="intent" class="boundary-editor__mnemonic" />
          <div class="boundary-editor__actions">
            <AppButton name="rerecord-boundary" size="sm" @click="emit('reRecord')">
              {{ t("actions.editSequence") }}
            </AppButton>
            <button
              type="button"
              class="gg-icon-button boundary-editor__delete"
              :aria-label="t('gestures.deleteIntent')"
              :title="t('gestures.deleteIntent')"
              @click="emit('delete')"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="gg-field">
      <span class="gg-field-label">{{ t("gestures.editorTitle") }}</span>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.boundary-editor { display: grid; min-width: 0; gap: 16px; }
.boundary-editor__summary {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(180px, 1.35fr) minmax(180px, 1fr);
  gap: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--gg-border);
}
.boundary-editor__summary > .gg-field,
.boundary-editor > .gg-field { min-width: 0; }
.boundary-editor__trigger-stack { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 8px; }
.boundary-editor__mnemonic { font-size: 20px; }
.boundary-editor__actions { display: flex; align-items: center; gap: 8px; }
.boundary-editor__delete { color: var(--gg-danger); }
</style>
