<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, RefreshCw, Search } from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppDialog,
  AppEmptyState,
  AppSkeleton,
  AppSpinner,
  AppTabs,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import {
  commandTemplateRisks,
  gestureIdentityKey,
  type GestureTemplateCatalogEntry,
  type GestureTemplateIntent,
} from "@godgesture/shared";
import { useTemplatesStore } from "../stores/templates";
import AppIcon from "../components/AppIcon.vue";
import GestureActionTable, { type GestureActionTableRow } from "../components/GestureActionTable.vue";
import MnemonicText from "../components/MnemonicText.vue";

const { t } = useI18n();
const templates = useTemplatesStore();
const { confirm } = useConfirmDialog();
const riskConfirmed = ref(false);

const detailVisible = computed({
  get: () => templates.selectedEntry !== null,
  set: (visible) => {
    if (!visible && !templates.adopting) templates.closeDetails();
  },
});
const selectedTargetIndex = ref(0);
const selectedIntentIndex = ref(0);
const detailTab = ref<"targets" | "gestures" | "preview">("targets");
const packageTargets = computed(() => templates.selectedPackage?.targets ?? []);
const selectedTarget = computed(() =>
  packageTargets.value[selectedTargetIndex.value] ?? packageTargets.value[0] ?? null,
);
const packageIntents = computed(() => selectedTarget.value?.intents ?? []);
const detailTabs = computed(() => [
  { id: "targets", label: t("templates.detail.tabs.targets"), count: packageTargets.value.length },
  { id: "gestures", label: t("templates.detail.tabs.gestures"), count: packageIntents.value.length },
  { id: "preview", label: t("templates.detail.tabs.preview") },
]);
const templateActionRows = computed<GestureActionTableRow[]>(() =>
  packageIntents.value.map((intent, index) => ({
    key: `${selectedTargetIndex.value}:${index}`,
    kind: "gesture" as const,
    name: intent.name,
    gesture: intent.gesture,
    commandType: intent.command.type,
    conflict: hasConflict(intent),
  })),
);
const selectedTemplateIntent = computed<GestureTemplateIntent | null>(
  () => packageIntents.value[selectedIntentIndex.value] ?? packageIntents.value[0] ?? null,
);
const conflictKeys = computed(
  () => new Set((templates.adoptionPlan?.conflicts ?? []).map((conflict) => gestureIdentityKey(conflict.gesture))),
);
const riskyIntents = computed(() =>
  packageTargets.value.flatMap((target) =>
    target.intents
      .filter((intent) => commandTemplateRisks(intent.command).length > 0)
      .map((intent) => ({ target, intent })),
  ),
);
const hasPluginInstall = computed(() => (templates.adoptionPlan?.pluginSources.length ?? 0) > 0);
const hasElevatedRisk = computed(() => riskyIntents.value.length > 0 || hasPluginInstall.value);

watch(
  () => templates.selectedEntry,
  () => {
    riskConfirmed.value = false;
    selectedTargetIndex.value = 0;
    selectedIntentIndex.value = 0;
    detailTab.value = "targets";
  },
);

watch(packageTargets, (targets) => {
  if (selectedTargetIndex.value >= targets.length) selectedTargetIndex.value = 0;
  if (selectedIntentIndex.value >= (selectedTarget.value?.intents.length ?? 0)) selectedIntentIndex.value = 0;
});

onMounted(() => {
  void templates.loadCatalog();
});

function localized(value: string): string {
  return value;
}

function entryScope(entry: GestureTemplateCatalogEntry): "global" | "app" | "mixed" {
  const scopes = new Set(entry.targets.map((target) => target.scope));
  return scopes.size > 1 ? "mixed" : [...scopes][0] ?? "app";
}

function scopeBadgeVariant(entry: GestureTemplateCatalogEntry): "info" | "warning" | "success" {
  const scope = entryScope(entry);
  return scope === "mixed" ? "warning" : scope === "global" ? "info" : "success";
}

function targetName(target: (typeof packageTargets.value)[number]): string {
  return target.scope === "global" ? t("gestures.globalApp") : target.name;
}

function targetBinding(target: (typeof packageTargets.value)[number]): string[] {
  if (target.scope === "global") return [];
  return [target.windows?.exeName, target.mac?.bundleId].filter((value): value is string => Boolean(value));
}

function selectTarget(index: number): void {
  selectedTargetIndex.value = index;
  selectedIntentIndex.value = 0;
}

function selectTemplateAction(key: string): void {
  const index = templateActionRows.value.findIndex((row) => row.key === key);
  if (index >= 0) selectedIntentIndex.value = index;
}

function hasConflict(intent: GestureTemplateIntent): boolean {
  return conflictKeys.value.has(gestureIdentityKey(intent.gesture));
}

function commandPreview(intent: GestureTemplateIntent): string {
  const command = intent.command;
  switch (command.type) {
    case "doNothing": return t("command.doNothing.desc");
    case "hotKey": return [...command.modifiers, ...command.keys].join(" + ");
    case "webSearch": return command.engineName;
    case "windowControl": return t(`command.windowControl.operations.${command.operation}`);
    case "taskSwitcher": return t("command.taskSwitcher.desc");
    case "openFile": return command.path;
    case "sendText": return command.text;
    case "gotoUrl": return command.url;
    case "cmd":
    case "powershell": return command.code;
    case "nodePlugin": return command.pluginId;
    case "audioVolume": return `${command.delta > 0 ? "+" : ""}${command.delta}%`;
  }
}

function openDetails(entry: GestureTemplateCatalogEntry): void {
  riskConfirmed.value = false;
  void templates.openDetails(entry);
}

function errorText(code: string): string {
  const key = `templates.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("templates.errors.unknown") : translated;
}

function confirmAdoption(): void {
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
      if (adopted) pushToast({ kind: "success", message: t("templates.adoption.success") });
      return adopted;
    },
  });
}
</script>

<template>
  <div class="gg-page templates-view">
    <header class="gg-page__header templates-view__header">
      <div>
        <h2>{{ t("templates.title") }}</h2>
        <p class="gg-hint">{{ t("templates.subtitle") }}</p>
      </div>
      <button
        type="button"
        class="gg-icon-button"
        :disabled="templates.loadingCatalog"
        :aria-busy="templates.loadingCatalog || undefined"
        :aria-label="t('templates.refresh')"
        :title="t('templates.refresh')"
        @click="templates.loadCatalog(true)"
      >
        <AppSpinner v-if="templates.loadingCatalog" size="sm" aria-hidden="true" />
        <RefreshCw v-else :size="18" aria-hidden="true" />
      </button>
    </header>

    <section class="templates-view__filters" :aria-label="t('templates.title')">
      <label class="templates-view__search">
        <span class="gg-sr-only">{{ t("templates.searchPlaceholder") }}</span>
        <Search :size="16" aria-hidden="true" />
        <input v-model="templates.query" class="gg-input" type="search" :placeholder="t('templates.searchPlaceholder')" />
      </label>
      <fieldset class="templates-view__scope-filter">
        <legend class="gg-sr-only">{{ t("templates.scope.all") }}</legend>
        <label v-for="scope in ['all', 'global', 'app']" :key="scope" class="templates-view__scope-option">
          <input v-model="templates.scopeFilter" type="radio" name="template-scope" :value="scope" />
          <span>{{ t(`templates.scope.${scope}`) }}</span>
        </label>
      </fieldset>
      <label class="gg-sr-only" for="template-risk-filter">{{ t("templates.risk.all") }}</label>
      <select id="template-risk-filter" v-model="templates.riskFilter" class="gg-select templates-view__risk-filter">
        <option value="all">{{ t("templates.risk.all") }}</option>
        <option value="low">{{ t("templates.risk.low") }}</option>
        <option value="elevated">{{ t("templates.risk.elevated") }}</option>
      </select>
    </section>

    <AppAlert v-if="templates.catalogError" variant="error" :title="errorText(templates.catalogError)">
      <AppButton size="sm" variant="ghost" @click="templates.loadCatalog(true)">
        <RefreshCw :size="15" aria-hidden="true" />
        {{ t("common.retry") }}
      </AppButton>
    </AppAlert>

    <section v-else class="templates-view__list" :aria-label="t('templates.title')">
      <AppSkeleton v-if="templates.loadingCatalog" :rows="4" />
      <AppEmptyState
        v-else-if="templates.filteredEntries.length === 0"
        :title="t(templates.entries.length ? 'templates.emptyFiltered' : 'templates.emptyCatalog')"
      />
      <button
        v-for="entry in templates.filteredEntries"
        v-else
        :key="`${entry.id}@${entry.versionNumber}`"
        type="button"
        class="templates-view__row"
        :aria-label="localized(entry.title)"
        @click="openDetails(entry)"
      >
        <span class="templates-view__row-main">
          <span class="templates-view__row-title">
            {{ localized(entry.title) }}
            <AppBadge>v{{ entry.versionNumber }}</AppBadge>
          </span>
          <span class="templates-view__summary">{{ localized(entry.summary) }}</span>
          <span class="templates-view__tags">
            <AppBadge v-for="tag in entry.tags" :key="tag" variant="info">{{ tag }}</AppBadge>
          </span>
        </span>
        <span class="templates-view__row-meta">
          <AppBadge :variant="scopeBadgeVariant(entry)">{{ t(`templates.scope.${entryScope(entry)}`) }}</AppBadge>
          <AppBadge :variant="entry.risks.length ? 'warning' : 'info'">
            {{ t(entry.risks.length ? "templates.risk.elevated" : "templates.risk.low") }}
          </AppBadge>
          <span>{{ entry.author }}</span>
        </span>
      </button>
    </section>

    <AppDialog
      class="template-detail"
      :open="detailVisible"
      :title="templates.selectedEntry ? localized(templates.selectedEntry.title) : ''"
      :close-label="t('common.close')"
      :busy="templates.adopting"
      @close="detailVisible = false"
    >
      <AppSkeleton v-if="templates.loadingPackage" :rows="7" />
      <AppAlert v-else-if="templates.packageError" variant="error" :title="t('templates.packageLoadFailed')">
        <p>{{ errorText(templates.packageError) }}</p>
        <AppButton
          variant="primary"
          size="sm"
          @click="templates.selectedEntry && templates.openDetails(templates.selectedEntry)"
        >
          <RefreshCw :size="15" aria-hidden="true" />
          {{ t("common.retry") }}
        </AppButton>
      </AppAlert>
      <template v-else-if="templates.selectedEntry && templates.selectedPackage">
        <header class="template-detail__hero">
          <div class="template-detail__hero-copy">
            <div class="template-detail__eyebrow">
              <code>{{ templates.selectedEntry.id }}</code>
              <AppBadge>v{{ templates.selectedEntry.versionNumber }}</AppBadge>
              <AppBadge variant="info">{{ templates.selectedEntry.author }}</AppBadge>
            </div>
            <h3>{{ localized(templates.selectedEntry.title) }}</h3>
            <p>{{ localized(templates.selectedEntry.summary) }}</p>
          </div>
          <div class="template-detail__hero-targets">
            <strong>{{ templates.selectedPackage.targets.length }}</strong>
            <span>{{ t("templates.detail.targets") }}</span>
          </div>
        </header>

        <AppTabs
          v-model="detailTab"
          class="template-detail__tabs"
          :tabs="detailTabs"
          :aria-label="t('templates.detail.targetNav')"
        >
          <template #targets>
            <div class="template-detail__target-panel">
              <aside class="template-detail__apps">
                <div class="template-detail__apps-head">
                  <span>{{ t("templates.detail.target") }}</span>
                  <span class="template-detail__apps-count">{{ packageTargets.length }}</span>
                </div>
                <ul class="template-detail__app-list">
                  <li
                    v-for="(target, index) in packageTargets"
                    :key="`${target.scope}-${index}-${target.scope === 'app' ? target.name : 'global'}`"
                    class="template-detail__app-item"
                    :class="{ 'is-active': selectedTargetIndex === index }"
                  >
                    <button
                      type="button"
                      class="template-detail__app-button"
                      :aria-label="targetName(target)"
                      :aria-current="selectedTargetIndex === index ? 'true' : undefined"
                      @click="selectTarget(index)"
                    >
                      <span class="template-detail__app-identity">
                        <AppIcon
                          :label="targetName(target)"
                          :global="target.scope === 'global'"
                          :windows-exe-name="target.scope === 'app' ? target.windows?.exeName : null"
                          :mac-bundle-id="target.scope === 'app' ? target.mac?.bundleId : null"
                        />
                        <span class="template-detail__app-copy">
                          <span class="template-detail__app-name">{{ targetName(target) }}</span>
                          <small v-if="targetBinding(target).length" class="template-detail__app-binding">
                            {{ targetBinding(target).join(" · ") }}
                          </small>
                        </span>
                      </span>
                      <span class="template-detail__app-count">{{ target.intents.length }}</span>
                    </button>
                  </li>
                </ul>
              </aside>
            </div>
          </template>

          <template #gestures>
            <section v-if="selectedTarget" class="template-detail__gesture-panel">
              <header class="template-detail__main-head">
                <div>
                  <h3>{{ targetName(selectedTarget) }}</h3>
                  <p class="gg-hint">{{ targetBinding(selectedTarget).join(" · ") || t("templates.detail.globalTarget") }}</p>
                </div>
                <AppBadge>{{ t("templates.detail.gestures", { count: selectedTarget.intents.length }) }}</AppBadge>
              </header>
              <GestureActionTable
                :rows="templateActionRows"
                :selected-key="templateActionRows[selectedIntentIndex]?.key ?? null"
                mode="readonly"
                @select="selectTemplateAction"
              />
            </section>
            <AppEmptyState v-else :title="t('gestures.emptyIntents')" />
          </template>

          <template #preview>
            <section class="template-detail__editor-pane">
              <div v-if="selectedTemplateIntent" class="template-detail__intent-editor">
                <div class="template-detail__intent-summary">
                  <div class="gg-field">
                    <span class="gg-field-label">{{ t("gestures.intentName") }}</span>
                    <div class="template-detail__readonly-value">{{ selectedTemplateIntent.name }}</div>
                  </div>
                  <div class="gg-field">
                    <span class="gg-field-label">{{ t("gestures.colMnemonic") }}</span>
                    <MnemonicText :gesture="selectedTemplateIntent.gesture" class="template-detail__editor-mnemonic" />
                  </div>
                  <div class="gg-field">
                    <span class="gg-field-label">{{ t("gestures.modifier") }}</span>
                    <div class="template-detail__readonly-value">{{ t(`modifier.${selectedTemplateIntent.gesture.modifier}`) }}</div>
                  </div>
                </div>
                <div class="gg-field template-detail__command-preview">
                  <span class="gg-field-label">{{ t("gestures.editorTitle") }}</span>
                  <div class="template-detail__command-value">
                    <AppBadge variant="info">{{ t(`command.types.${selectedTemplateIntent.command.type}`) }}</AppBadge>
                    <code v-if="commandPreview(selectedTemplateIntent)">{{ commandPreview(selectedTemplateIntent) }}</code>
                  </div>
                </div>
              </div>
              <p v-else class="gg-hint">{{ t("gestures.noSelection") }}</p>
            </section>
          </template>
        </AppTabs>

        <AppAlert
          v-if="hasElevatedRisk"
          variant="warning"
          :title="t('templates.risk.warningTitle', { count: riskyIntents.length })"
        >
          <ul class="template-detail__risk-list">
            <li v-for="(risk, index) in riskyIntents" :key="`${risk.target.scope}-${index}-${risk.intent.name}`">
              {{ targetName(risk.target) }} · {{ risk.intent.name }} - {{ t(`command.types.${risk.intent.command.type}`) }}
            </li>
          </ul>
        </AppAlert>
        <AppAlert v-else variant="success" :title="t('templates.risk.lowDescription')" />

        <AppAlert
          v-if="templates.adoptionPlan?.pluginSources.length"
          class="template-detail__plugin-warning"
          variant="warning"
          :title="t('templates.adoption.plugins', { count: templates.adoptionPlan.pluginSources.length })"
        >
          <ul class="template-detail__risk-list">
            <li v-for="source in templates.adoptionPlan.pluginSources" :key="source.pluginId">
              <code>{{ source.pluginId }}<template v-if="source.subdirectory"> / {{ source.subdirectory }}</template></code>
            </li>
          </ul>
        </AppAlert>

        <div v-if="templates.adoptionPlan" class="template-detail__adoption">
          <section v-if="templates.adoptionPlan.conflicts.length" class="template-detail__conflicts">
            <h3>{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</h3>
            <ul>
              <li v-for="(conflict, index) in templates.adoptionPlan.conflicts" :key="`${gestureIdentityKey(conflict.gesture)}-${index}`">
                <MnemonicText :gesture="conflict.gesture" /> {{ conflict.templateName }} / {{ conflict.existingNames.join(", ") }}
              </li>
            </ul>
            <fieldset class="template-detail__conflict-policy">
              <legend class="gg-sr-only">{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</legend>
              <label>
                <input
                  :checked="templates.conflictPolicy === 'keepExisting'"
                  type="radio"
                  name="template-conflict-policy"
                  value="keepExisting"
                  @change="templates.setConflictPolicy('keepExisting')"
                />
                <span>{{ t("templates.adoption.keepExisting") }}</span>
              </label>
              <label>
                <input
                  :checked="templates.conflictPolicy === 'replaceExisting'"
                  type="radio"
                  name="template-conflict-policy"
                  value="replaceExisting"
                  @change="templates.setConflictPolicy('replaceExisting')"
                />
                <span>{{ t("templates.adoption.replaceExisting") }}</span>
              </label>
            </fieldset>
          </section>

          <div class="template-detail__stats">
            <span>{{ t("templates.adoption.added", { count: templates.adoptionPlan.stats.added }) }}</span>
            <span>{{ t("templates.adoption.replaced", { count: templates.adoptionPlan.stats.replaced }) }}</span>
            <span>{{ t("templates.adoption.skipped", { count: templates.adoptionPlan.stats.skipped }) }}</span>
          </div>
          <label v-if="hasElevatedRisk" class="template-detail__risk-confirm">
            <input v-model="riskConfirmed" type="checkbox" />
            <span>{{ t("templates.risk.confirm") }}</span>
          </label>
        </div>

        <AppAlert v-if="templates.adoptionError" variant="error" :title="errorText(templates.adoptionError)" />
      </template>

      <template #footer>
        <AppButton :disabled="templates.adopting" @click="detailVisible = false">{{ t("common.cancel") }}</AppButton>
        <AppButton
          data-testid="templates-adopt"
          variant="primary"
          :loading="templates.adopting"
          :loading-label="t('templates.adoption.apply')"
          :disabled="!templates.adoptionPlan || (hasElevatedRisk && !riskConfirmed)"
          @click="confirmAdoption"
        >
          <Download :size="16" aria-hidden="true" />
          {{ t("templates.adoption.apply") }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>

<style scoped>
.templates-view { width: min(100%, 920px); height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 14px; overflow: hidden; }
.templates-view__header > div { min-width: 0; }
.templates-view__header h2, .template-detail__conflicts h3 { margin: 0; font-size: 16px; }
.templates-view__header p { margin: 5px 0 0; }
.templates-view__filters { display: grid; grid-template-columns: minmax(180px, 1fr) auto 150px; gap: 10px; align-items: center; }
.templates-view__search { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--gg-border); border-radius: 6px; padding: 0 10px; color: var(--gg-text-muted); background: var(--gg-surface); }
.templates-view__search:focus-within { outline: 2px solid var(--gg-ring); outline-offset: 1px; }
.templates-view__search .gg-input { min-width: 0; border: 0; box-shadow: none; }
.templates-view__scope-filter, .template-detail__conflict-policy { display: flex; gap: 2px; margin: 0; padding: 2px; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface-muted); }
.templates-view__scope-option, .template-detail__conflict-policy label, .template-detail__risk-confirm { display: inline-flex; align-items: center; gap: 6px; color: var(--gg-text); font-size: 12px; cursor: pointer; }
.templates-view__scope-option { min-height: 32px; padding: 0 8px; border-radius: 4px; }
.templates-view__scope-option:has(input:checked) { color: var(--gg-primary); background: var(--gg-surface); }
.templates-view__scope-option input, .template-detail__conflict-policy input, .template-detail__risk-confirm input { accent-color: var(--gg-primary); }
.templates-view__list { min-width: 0; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; border-top: 1px solid var(--gg-border); }
.templates-view__row { width: 100%; min-height: 94px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; padding: 13px 8px; border: 0; border-bottom: 1px solid var(--gg-border); color: var(--gg-text); background: var(--gg-surface); text-align: left; cursor: pointer; }
.templates-view__row:hover { background: var(--gg-surface-hover); }
.templates-view__row:focus-visible { outline: 2px solid var(--gg-ring); outline-offset: -2px; }
.templates-view__row-main, .templates-view__row-meta, .templates-view__tags { display: flex; }
.templates-view__row-main { min-width: 0; flex-direction: column; gap: 7px; }
.templates-view__row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 14px; font-weight: 600; }
.templates-view__summary { color: var(--gg-text-muted); font-size: 13px; line-height: 1.45; }
.templates-view__tags { flex-wrap: wrap; gap: 5px; }
.templates-view__row-meta { width: 128px; flex-direction: column; align-items: flex-end; gap: 7px; color: var(--gg-text-muted); font-size: 12px; }
:global(.template-detail) {
  width: min(100%, 750px);
  height: min(720px, calc(100dvh - 60px));
  max-height: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
:global(.template-detail .gg-dialog__body) { min-height: 0; flex: 1; overflow-y: auto; }
.template-detail__hero { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--gg-border); }
.template-detail__hero-copy { min-width: 0; }
.template-detail__eyebrow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; color: var(--gg-text-muted); font-size: 12px; }
.template-detail__hero h3 { margin: 0; font-size: 20px; line-height: 1.25; }
.template-detail__hero p { margin: 6px 0 0; color: var(--gg-text-muted); line-height: 1.55; }
.template-detail__hero-targets { display: flex; flex: 0 0 86px; flex-direction: column; justify-content: center; align-items: flex-end; color: var(--gg-text-muted); text-align: right; }
.template-detail__hero-targets strong { color: var(--gg-primary); font-size: 26px; line-height: 1; }
.template-detail__hero-targets span { margin-top: 6px; font-size: 12px; }
.template-detail__tabs { min-width: 0; margin-top: 16px; }
:deep(.template-detail__tabs .gg-tabs__panel) { min-height: 0; }
.template-detail__target-panel,
.template-detail__gesture-panel,
.template-detail__editor-pane { min-width: 0; min-height: 420px; }
.template-detail__target-panel { border: 1px solid var(--gg-border); border-radius: 6px; overflow: hidden; }
.template-detail__apps { min-width: 0; min-height: 0; height: 420px; display: flex; flex-direction: column; overflow: hidden; background: var(--gg-surface-muted); }
.template-detail__apps-head { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 10px; border-bottom: 1px solid var(--gg-border); color: var(--gg-text-muted); font-size: 13px; }
.template-detail__apps-count, .template-detail__app-count { color: var(--gg-text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.template-detail__app-list { min-height: 0; flex: 1; margin: 0; padding: 6px; overflow-y: auto; list-style: none; }
.template-detail__app-button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 5px 7px; border: 0; border-radius: 5px; color: var(--gg-text); background: transparent; text-align: left; cursor: pointer; }
.template-detail__app-button:hover { background: var(--gg-surface-hover); }
.template-detail__app-button:focus-visible { outline: 2px solid var(--gg-ring); outline-offset: -2px; }
.template-detail__app-item.is-active .template-detail__app-button { color: var(--gg-primary); background: var(--gg-primary-soft); }
.template-detail__app-identity, .template-detail__app-copy { display: flex; min-width: 0; }
.template-detail__app-identity { flex: 1; align-items: center; gap: 8px; }
.template-detail__app-copy { flex-direction: column; gap: 2px; }
.template-detail__app-name, .template-detail__app-binding { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.template-detail__app-name { font-size: 13px; }.template-detail__app-binding { color: var(--gg-text-muted); font-size: 11px; }
.template-detail__gesture-panel { display: grid; min-height: 420px; grid-template-rows: auto minmax(0, 1fr); gap: 10px; }
.template-detail__main-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.template-detail__main-head h3 { margin: 0; font-size: 15px; }
.template-detail__main-head p { margin: 4px 0 0; overflow-wrap: anywhere; }
.template-detail__gesture-panel :deep(.gesture-action-table) { min-height: 0; height: 100%; }
.template-detail__editor-pane { padding: 12px 14px; overflow-y: auto; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface); }
.template-detail__intent-editor { display: grid; min-width: 0; gap: 16px; }.template-detail__intent-summary { display: grid; grid-template-columns: minmax(150px, 1.35fr) minmax(150px, 1fr) minmax(100px, .8fr); gap: 12px 18px; padding-bottom: 14px; border-bottom: 1px solid var(--gg-border); }.template-detail__readonly-value { display: flex; align-items: center; min-height: 32px; padding: 0 11px; overflow-wrap: anywhere; border: 1px solid var(--gg-border); border-radius: 5px; color: var(--gg-text); background: var(--gg-surface-muted); }.template-detail__editor-mnemonic { min-height: 32px; font-size: 20px; }.template-detail__command-value { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 8px; }.template-detail__command-value code { display: block; max-width: 100%; overflow: auto; color: var(--gg-text); font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.template-detail__risk-list, .template-detail__conflicts ul { margin: 5px 0 0; padding-left: 18px; line-height: 1.5; }.template-detail__adoption { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }.template-detail__conflicts { padding: 10px 12px; border: 1px solid var(--gg-border); border-radius: 6px; }.template-detail__conflicts ul { font-size: 12px; }.template-detail__conflict-policy { width: fit-content; margin-top: 9px; }.template-detail__conflict-policy label { min-height: 32px; padding: 0 7px; }.template-detail__stats { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--gg-text); font-size: 13px; }.template-detail__risk-confirm { width: fit-content; min-height: 32px; }
</style>
