<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  modelValue: boolean;
  title: string;
  summary: string;
  author: string;
  targets: number;
  gestures: number;
  risks: string[];
  plugins: string[];
  usage: { submissionsToday: number; pendingVersions: number; publishedTemplates: number };
  limits: { dailySubmissionLimit: number; pendingVersionLimit: number; publishedTemplateLimit: number; maxPackageBytes: number };
}>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void; (event: "confirm"): void }>();
const { t } = useI18n();
const visible = computed({ get: () => props.modelValue, set: (value) => emit("update:modelValue", value) });
</script>
<template>
  <el-dialog v-model="visible" width="min(560px, calc(100vw - 32px))" :title="t('gestures.exportDialog.reviewTitle')" destroy-on-close>
    <section class="review">
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item :label="t('gestures.exportDialog.templateTitle')">{{ title }}</el-descriptions-item>
        <el-descriptions-item :label="t('gestures.exportDialog.templateSummary')">{{ summary }}</el-descriptions-item>
        <el-descriptions-item :label="t('gestures.exportDialog.reviewAuthor')">{{ author }}</el-descriptions-item>
        <el-descriptions-item :label="t('gestures.exportDialog.reviewTargets')">{{ targets }} / {{ gestures }}</el-descriptions-item>
      </el-descriptions>
      <div class="review__section"><strong>{{ t('gestures.exportDialog.reviewRisks') }}</strong><div><el-tag v-for="risk in risks" :key="risk" type="warning" size="small">{{ risk }}</el-tag><span v-if="!risks.length" class="muted">{{ t('common.none') }}</span></div></div>
      <div class="review__section"><strong>{{ t('gestures.exportDialog.reviewPlugins') }}</strong><div><el-tag v-for="plugin in plugins" :key="plugin" size="small">{{ plugin }}</el-tag><span v-if="!plugins.length" class="muted">{{ t('common.none') }}</span></div></div>
      <div class="review__section"><strong>{{ t('gestures.exportDialog.reviewQuota') }}</strong><span class="muted">{{ usage.submissionsToday }} / {{ limits.dailySubmissionLimit }} {{ t('gestures.exportDialog.reviewQuotaDaily') }} · {{ usage.pendingVersions }} / {{ limits.pendingVersionLimit }} {{ t('gestures.exportDialog.reviewQuotaPending') }}</span></div>
      <el-alert type="warning" :closable="false" :title="t('gestures.exportDialog.moderationNotice')" />
    </section>
    <template #footer><el-button @click="visible = false">{{ t('common.cancel') }}</el-button><el-button type="primary" @click="emit('confirm')">{{ t('gestures.exportDialog.confirmSubmit') }}</el-button></template>
  </el-dialog>
</template>
<style scoped>.review{display:grid;gap:14px}.review__section{display:grid;gap:6px}.review__section .el-tag{margin:0 5px 5px 0}.muted{color:var(--el-text-color-secondary);font-size:12px}</style>
