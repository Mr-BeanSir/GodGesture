<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, FileJson, ShieldCheck, TriangleAlert } from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppDialog,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import {
  GestureTemplateProtocolError,
  commandTemplateRisks,
  parseGestureTemplatePackage,
} from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useTemplatesStore } from "../stores/templates";
import MnemonicText from "./MnemonicText.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();

const { t } = useI18n();
const backend = useBackend();
const templates = useTemplatesStore();
const { confirm } = useConfirmDialog();

const phase = ref<"pick" | "review">("pick");
const loading = ref(false);
const importError = ref<string | null>(null);
const riskConfirmed = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const busy = computed(() => loading.value || templates.adopting);
const packageTargets = computed(() => templates.selectedPackage?.targets ?? []);
const packageIntents = computed(() => packageTargets.value.flatMap((target) => target.intents));
const riskyIntents = computed(() =>
  packageIntents.value.filter((intent) => commandTemplateRisks(intent.command).length > 0),
);
const hasPluginInstall = computed(() => (templates.adoptionPlan?.pluginSources.length ?? 0) > 0);
const hasElevatedRisk = computed(() => riskyIntents.value.length > 0 || hasPluginInstall.value);

function errorText(code: string): string {
  const key = `templates.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("gestures.importDialog.failed") : translated;
}

function reset() {
  phase.value = "pick";
  loading.value = false;
  importError.value = null;
  riskConfirmed.value = false;
  templates.closeDetails();
}

async function chooseFile() {
  if (loading.value) return;
  loading.value = true;
  importError.value = null;
  try {
    const text = await backend.gestureTemplateOpen(t("gestures.importDialog.fileTitle"));
    if (!text) return;
    try {
      const templatePackage = parseGestureTemplatePackage(text);
      templates.openLocalPackage(templatePackage);
      phase.value = "review";
      riskConfirmed.value = false;
    } catch (error) {
      const code = error instanceof GestureTemplateProtocolError ? error.code : "invalid_package";
      importError.value = errorText(code);
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
    importError.value = errorText(code);
  } finally {
    loading.value = false;
  }
}

function requestClose() {
  if (!busy.value) visible.value = false;
}

function targetName(target: (typeof packageTargets.value)[number]): string {
  return target.scope === "global" ? t("gestures.globalApp") : target.name;
}

function confirmAdoption() {
  const plan = templates.adoptionPlan;
  if (!plan || (hasElevatedRisk.value && !riskConfirmed.value) || templates.adopting) return;
  void confirm({
    title: t("templates.adoption.confirmTitle"),
    message: t("templates.adoption.confirmBody", { ...plan.stats, plugins: plan.pluginSources.length }),
    confirmLabel: t("templates.adoption.apply"),
    cancelLabel: t("common.cancel"),
    variant: "primary",
    onConfirm: async () => {
      const adopted = await templates.adopt();
      if (adopted) {
        pushToast({ kind: "success", message: t("templates.adoption.success") });
        visible.value = false;
      }
      return adopted;
    },
  });
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      void chooseFile();
    } else if (!templates.adopting) {
      templates.closeDetails();
    }
  },
  { immediate: true },
);
</script>

<template>
  <AppDialog
    :open="visible"
    :title="phase === 'pick' ? t('gestures.importDialog.title') : t('gestures.importDialog.review')"
    :close-label="t('common.cancel')"
    :busy="busy"
    @close="requestClose"
  >
    <template v-if="phase === 'pick'">
      <div class="gesture-import__pick">
        <FileJson :size="34" aria-hidden="true" />
        <p class="gg-hint">{{ t("gestures.importDialog.description") }}</p>
        <AppButton variant="primary" :loading="loading" @click="chooseFile">
          <FileJson :size="16" aria-hidden="true" />
          {{ t("gestures.importDialog.chooseFile") }}
        </AppButton>
      </div>
      <AppAlert v-if="importError" variant="error" :title="importError" />
    </template>

    <template v-else>
      <header class="gesture-import__hero">
        <div>
          <span class="gesture-import__eyebrow">{{ t("gestures.importDialog.review") }}</span>
          <h3>{{ templates.selectedEntry?.title }}</h3>
          <p class="gg-hint">{{ templates.selectedEntry?.summary }}</p>
        </div>
        <AppBadge :variant="hasElevatedRisk ? 'warning' : 'success'">
          {{ t(hasElevatedRisk ? "templates.risk.elevated" : "templates.risk.low") }}
        </AppBadge>
      </header>

      <div v-if="templates.adoptionPlan" class="gesture-import__stats">
        <span>{{ t("templates.adoption.added", { count: templates.adoptionPlan.stats.added }) }}</span>
        <span>{{ t("templates.adoption.replaced", { count: templates.adoptionPlan.stats.replaced }) }}</span>
        <span>{{ t("templates.adoption.skipped", { count: templates.adoptionPlan.stats.skipped }) }}</span>
      </div>

      <AppAlert
        v-if="riskyIntents.length"
        variant="warning"
        :title="t('templates.risk.warningTitle', { count: riskyIntents.length })"
      >
        <ul class="gesture-import__risk-list">
          <li v-for="(intent, index) in riskyIntents" :key="`${intent.name}-${index}`">
            {{ intent.name }} · {{ t(`command.types.${intent.command.type}`) }}
          </li>
        </ul>
      </AppAlert>
      <AppAlert
        v-else-if="!hasPluginInstall"
        variant="success"
        :title="t('templates.risk.lowDescription')"
      >
        <ShieldCheck :size="16" aria-hidden="true" />
      </AppAlert>
      <AppAlert
        v-if="hasPluginInstall"
        variant="warning"
        :title="t('templates.adoption.plugins', { count: templates.adoptionPlan?.pluginSources.length ?? 0 })"
      />

      <section v-if="templates.adoptionPlan?.conflicts.length" class="gesture-import__conflicts">
        <div class="gesture-import__section-heading">
          <h3>{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</h3>
          <TriangleAlert :size="17" aria-hidden="true" />
        </div>
        <ul>
          <li v-for="(conflict, index) in templates.adoptionPlan.conflicts" :key="`${conflict.templateName}-${index}`">
            <MnemonicText :gesture="conflict.gesture" />
            <span>{{ conflict.templateName }} / {{ conflict.existingNames.join(", ") }}</span>
          </li>
        </ul>
        <fieldset class="gesture-import__conflict-policy">
          <legend class="gg-sr-only">{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</legend>
          <label :class="{ 'is-selected': templates.conflictPolicy === 'keepExisting' }">
            <input
              type="radio"
              name="gesture-import-conflict-policy"
              :checked="templates.conflictPolicy === 'keepExisting'"
              @change="templates.setConflictPolicy('keepExisting')"
            />
            <span>{{ t("templates.adoption.keepExisting") }}</span>
          </label>
          <label :class="{ 'is-selected': templates.conflictPolicy === 'replaceExisting' }">
            <input
              type="radio"
              name="gesture-import-conflict-policy"
              :checked="templates.conflictPolicy === 'replaceExisting'"
              @change="templates.setConflictPolicy('replaceExisting')"
            />
            <span>{{ t("templates.adoption.replaceExisting") }}</span>
          </label>
        </fieldset>
      </section>

      <p v-if="templates.adoptionPlan && packageTargets.length" class="gesture-import__targets">
        {{ packageTargets.map(targetName).join(" · ") }}
      </p>
      <AppAlert v-if="templates.adoptionError" variant="error" :title="errorText(templates.adoptionError)" />
    </template>

    <template #footer>
      <template v-if="phase === 'pick'">
        <AppButton :disabled="busy" @click="requestClose">{{ t("common.cancel") }}</AppButton>
      </template>
      <template v-else>
        <label v-if="hasElevatedRisk" class="gesture-import__risk-confirm">
          <input v-model="riskConfirmed" type="checkbox" />
          <span>{{ t("templates.risk.confirm") }}</span>
        </label>
        <AppButton :disabled="busy" @click="requestClose">{{ t("common.cancel") }}</AppButton>
        <AppButton
          data-testid="gesture-template-import"
          variant="primary"
          :loading="templates.adopting"
          :disabled="!templates.adoptionPlan || (hasElevatedRisk && !riskConfirmed)"
          @click="confirmAdoption"
        >
          <Download :size="16" aria-hidden="true" />
          {{ t("templates.adoption.apply") }}
        </AppButton>
      </template>
    </template>
  </AppDialog>
</template>

<style scoped>
.gesture-import__pick {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 26px 18px;
  border: 1px dashed var(--gg-border);
  border-radius: 8px;
  color: var(--gg-primary);
  text-align: center;
}

.gesture-import__pick p { margin: 0; }
.gesture-import__pick .gg-button { min-width: 150px; }

.gesture-import__hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--gg-border);
}

.gesture-import__hero h3 { margin: 4px 0 0; color: var(--gg-text); font-size: 16px; }
.gesture-import__hero p { margin: 5px 0 0; }
.gesture-import__eyebrow { color: var(--gg-text-muted); font-size: 12px; }

.gesture-import__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
}

.gesture-import__stats span {
  padding: 5px 8px;
  border: 1px solid var(--gg-border);
  border-radius: 5px;
  color: var(--gg-text-muted);
  font-size: 12px;
}

.gesture-import__risk-list { margin: 6px 0 0; padding-left: 18px; }
.gesture-import__conflicts { margin-top: 14px; border: 1px solid var(--gg-border); border-radius: 7px; padding: 12px; }
.gesture-import__section-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--gg-warning); }
.gesture-import__section-heading h3 { margin: 0; color: var(--gg-text); font-size: 13px; }
.gesture-import__conflicts ul { margin: 9px 0; padding-left: 18px; color: var(--gg-text-muted); font-size: 12px; }
.gesture-import__conflicts li { display: flex; gap: 8px; margin-top: 5px; }
.gesture-import__conflict-policy { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; border: 0; }
.gesture-import__conflict-policy label { display: inline-flex; align-items: center; gap: 6px; padding: 7px 9px; border: 1px solid var(--gg-border); border-radius: 5px; color: var(--gg-text-muted); font-size: 12px; cursor: pointer; }
.gesture-import__conflict-policy label.is-selected { border-color: var(--gg-primary-border); color: var(--gg-primary); background: var(--gg-primary-soft); }
.gesture-import__targets { margin: 12px 0 0; color: var(--gg-text-muted); font-size: 12px; }
.gesture-import__risk-confirm { display: inline-flex; align-items: center; gap: 7px; margin-right: auto; color: var(--gg-text-muted); font-size: 12px; }

:deep(.gesture-import__pick + .gg-alert) { margin-top: 12px; }
</style>
