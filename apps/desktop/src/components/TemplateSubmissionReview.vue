<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { AppAlert, AppBadge, AppButton, AppDialog } from "@godgesture/ui";

const props = withDefaults(defineProps<{
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
  busy?: boolean;
}>(), { busy: false });

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
  (event: "confirm"): void;
}>();

const { t } = useI18n();
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const details = computed(() => [
  { label: t("gestures.exportDialog.templateTitle"), value: props.title },
  { label: t("gestures.exportDialog.templateSummary"), value: props.summary },
  { label: t("gestures.exportDialog.reviewAuthor"), value: props.author },
  { label: t("gestures.exportDialog.reviewTargets"), value: `${props.targets} / ${props.gestures}` },
]);
</script>

<template>
  <AppDialog
    :open="visible"
    :title="t('gestures.exportDialog.reviewTitle')"
    :close-label="t('common.cancel')"
    :busy="busy"
    class="review-dialog"
    @close="visible = false"
  >
    <section class="review">
      <dl class="review__details">
        <div v-for="detail in details" :key="detail.label" class="review__detail">
          <dt>{{ detail.label }}</dt>
          <dd>{{ detail.value }}</dd>
        </div>
      </dl>

      <section class="review__section" :aria-label="t('gestures.exportDialog.reviewRisks')">
        <h3>{{ t("gestures.exportDialog.reviewRisks") }}</h3>
        <div class="review__badges">
          <AppBadge v-for="risk in risks" :key="risk" variant="warning">{{ risk }}</AppBadge>
          <span v-if="!risks.length" class="review__muted">{{ t("common.none") }}</span>
        </div>
      </section>

      <section class="review__section" :aria-label="t('gestures.exportDialog.reviewPlugins')">
        <h3>{{ t("gestures.exportDialog.reviewPlugins") }}</h3>
        <div class="review__badges">
          <AppBadge v-for="plugin in plugins" :key="plugin">{{ plugin }}</AppBadge>
          <span v-if="!plugins.length" class="review__muted">{{ t("common.none") }}</span>
        </div>
      </section>

      <section class="review__section">
        <h3>{{ t("gestures.exportDialog.reviewQuota") }}</h3>
        <p class="review__muted review__quota">
          {{ usage.submissionsToday }} / {{ limits.dailySubmissionLimit }} {{ t("gestures.exportDialog.reviewQuotaDaily") }}
          <span aria-hidden="true">&middot;</span>
          {{ usage.pendingVersions }} / {{ limits.pendingVersionLimit }} {{ t("gestures.exportDialog.reviewQuotaPending") }}
        </p>
      </section>

      <AppAlert variant="warning" :title="t('gestures.exportDialog.moderationNotice')" />
    </section>

    <template #footer>
      <AppButton variant="secondary" :disabled="busy" @click="visible = false">
        {{ t("common.cancel") }}
      </AppButton>
      <AppButton variant="primary" :loading="busy" @click="emit('confirm')">
        {{ t("gestures.exportDialog.confirmSubmit") }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.review {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.review__details {
  margin: 0;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  overflow: hidden;
}

.review__detail {
  display: grid;
  grid-template-columns: minmax(132px, 0.36fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--gg-border);
}

.review__detail:last-child {
  border-bottom: 0;
}

.review__detail dt,
.review__detail dd {
  min-width: 0;
  margin: 0;
  padding: 9px 10px;
  overflow-wrap: anywhere;
}

.review__detail dt {
  color: var(--gg-text-muted);
  background: var(--gg-surface-muted);
  font-size: 12px;
  font-weight: 600;
}

.review__detail dd {
  color: var(--gg-text);
  line-height: 1.5;
}

.review__section {
  display: grid;
  gap: 6px;
}

.review__section h3 {
  margin: 0;
  color: var(--gg-text);
  font-size: 13px;
  line-height: 20px;
}

.review__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.review__muted {
  margin: 0;
  color: var(--gg-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.review__quota {
  font-variant-numeric: tabular-nums;
}

.review__quota span {
  margin: 0 4px;
}

</style>
