<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { BoundaryIntent } from "@godgesture/shared";
import BoundaryMnemonic from "./BoundaryMnemonic.vue";
import CommandEditor from "./CommandEditor.vue";

defineProps<{ intent: BoundaryIntent }>();
const emit = defineEmits<{ (event: "reRecord"): void }>();
const { t } = useI18n();
</script>

<template>
  <div class="boundary-editor">
    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.intentName") }}</label>
      <el-input v-model="intent.name" maxlength="64" class="boundary-editor__name" />
    </div>
    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.colMnemonic") }}</label>
      <div class="boundary-editor__mnemonic-row">
        <BoundaryMnemonic :intent="intent" />
        <el-button size="small" @click="emit('reRecord')">{{ t("actions.editSequence") }}</el-button>
      </div>
    </div>
    <el-divider />
    <div class="gg-field">
      <label class="gg-field-label">{{ t("gestures.editorTitle") }}</label>
      <CommandEditor v-model="intent.command" />
    </div>
  </div>
</template>

<style scoped>
.boundary-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.boundary-editor__name {
  max-width: 260px;
}
.boundary-editor__mnemonic-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
