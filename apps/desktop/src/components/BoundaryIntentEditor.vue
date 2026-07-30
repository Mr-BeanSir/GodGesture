<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Delete } from "@element-plus/icons-vue";
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
        <label class="gg-field-label">{{ t("gestures.intentName") }}</label>
        <el-input v-model="intent.name" maxlength="64" />
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("gestures.colMnemonic") }}</label>
        <div class="boundary-editor__mnemonic-row">
          <BoundaryMnemonic :intent="intent" />
          <el-button size="small" @click="emit('reRecord')">{{ t("actions.editSequence") }}</el-button>
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
    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.editorTitle") }}</label>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.boundary-editor {
  display: grid;
  gap: 16px;
}
.boundary-editor__summary {
  display: grid;
  grid-template-columns: minmax(180px, 1.35fr) minmax(180px, 1fr);
  gap: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.boundary-editor__mnemonic-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
@media (max-width: 760px) {
  .boundary-editor__summary {
    grid-template-columns: 1fr;
  }
}
</style>
