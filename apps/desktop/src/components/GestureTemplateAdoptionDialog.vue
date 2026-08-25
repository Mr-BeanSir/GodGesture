<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Download, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppDialog,
  AppEmptyState,
  AppSkeleton,
  AppTabs,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import {
  commandTemplateRisks,
  gestureIdentityKey,
  type GestureTemplateIntent,
} from "@godgesture/shared";
import { useTemplatesStore } from "../stores/templates";
import AppIcon from "./AppIcon.vue";
import GestureActionTable, { type GestureActionTableRow } from "./GestureActionTable.vue";
import MnemonicText from "./MnemonicText.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    closeLabel?: string;
  }>(),
  { closeLabel: "Close" },
);
const emit = defineEmits<{
  close: [];
  adopted: [];
}>();

const { t } = useI18n();
const templates = useTemplatesStore();
const { confirm } = useConfirmDialog();

const selectedTargetIndex = ref(0);
const selectedIntentIndex = ref(0);
const detailSectionTab = ref<"detail" | "review">("detail");
const packageTargets = computed(() => templates.selectedPackage?.targets ?? []);
const packageIntentCount = computed(() =>
  packageTargets.value.reduce((count, target) => count + target.intents.length, 0),
);
const selectedTarget = computed(() =>
  packageTargets.value[selectedTargetIndex.value] ?? packageTargets.value[0] ?? null,
);
const packageIntents = computed(() => selectedTarget.value?.intents ?? []);
const detailSectionTabs = computed(() => [
  { id: "detail", label: t("templates.detail.tabs.detail") },
  { id: "review", label: t("templates.detail.tabs.review") },
]);
const templateActionRows = computed<GestureActionTableRow[]>(() =>
  packageIntents.value.map((intent, index) => ({
    key: String(selectedTargetIndex.value) + ":" + String(index),
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
const riskConfirmed = ref(false);

watch(
  () => templates.selectedEntry,
  () => {
    riskConfirmed.value = false;
    selectedTargetIndex.value = 0;
    selectedIntentIndex.value = 0;
    detailSectionTab.value = "detail";
  },
);

watch(packageTargets, (targets) => {
  if (selectedTargetIndex.value >= targets.length) selectedTargetIndex.value = 0;
  if (selectedIntentIndex.value >= (selectedTarget.value?.intents.length ?? 0)) selectedIntentIndex.value = 0;
});

function localized(value: string): string {
  return value;
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
    case "hotKey": return command.modifiers.concat(command.keys).join(" + ");
    case "webSearch": return command.engineName;
    case "windowControl": return t("command.windowControl.operations." + command.operation);
    case "taskSwitcher": return t("command.taskSwitcher.desc");
    case "openFile": return command.path;
    case "sendText": return command.text;
    case "gotoUrl": return command.url;
    case "cmd":
    case "powershell": return command.code;
    case "nodePlugin": return command.pluginId;
    case "audioVolume": return (command.delta > 0 ? "+" : "") + String(command.delta) + "%";
  }
}

function requestClose(): void {
  if (!templates.adopting) emit("close");
}

function errorText(code: string): string {
  const key = "templates.errors." + code;
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
      if (adopted) {
        pushToast({ kind: "success", message: t("templates.adoption.success") });
        emit("adopted");
      }
      return adopted;
    },
  });
}

</script>

<template>
  <AppDialog
    class="template-detail"
    :open="props.open"
    :title="templates.selectedEntry ? localized(templates.selectedEntry.title) : ''"
    :close-label="props.closeLabel"
    :busy="templates.adopting"
    @close="requestClose"
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
          <p class="template-detail__hero-summary">{{ localized(templates.selectedEntry.summary) }}</p>
          <div v-if="templates.selectedEntry.tags.length" class="template-detail__hero-tags">
            <AppBadge v-for="tag in templates.selectedEntry.tags" :key="tag" variant="info">{{ tag }}</AppBadge>
          </div>
        </div>
        <div class="template-detail__hero-metrics">
          <div class="template-detail__metric">
            <strong>{{ templates.selectedPackage.targets.length }}</strong>
            <span>{{ t("templates.detail.targets") }}</span>
          </div>
          <div class="template-detail__metric">
            <strong>{{ packageIntentCount }}</strong>
            <span>{{ t("gestures.intentListTitle") }}</span>
          </div>
        </div>
      </header>

      <AppTabs
        v-model="detailSectionTab"
        class="template-detail__sections"
        :tabs="detailSectionTabs"
        :aria-label="t('templates.detail.sectionNav')"
      >
        <template #detail>
          <div class="template-detail__workspace">
            <aside class="template-detail__apps">
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

            <section v-if="selectedTarget" class="template-detail__main">
              <GestureActionTable
                :rows="templateActionRows"
                :selected-key="templateActionRows[selectedIntentIndex]?.key ?? null"
                mode="readonly"
                :show-toolbar="false"
                @select="selectTemplateAction"
              />

              <section class="template-detail__editor-pane" :aria-label="t('gestures.editorTitle')">
                <div v-if="selectedTemplateIntent" class="template-detail__intent-editor">
                  <div class="template-detail__intent-summary">
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
                    <span class="template-detail__command-label"><Terminal :size="15" aria-hidden="true" />{{ t("gestures.colCommand") }}</span>
                    <div class="template-detail__command-value">
                      <code v-if="commandPreview(selectedTemplateIntent)">{{ commandPreview(selectedTemplateIntent) }}</code>
                    </div>
                  </div>
                </div>
                <p v-else class="gg-hint">{{ t("gestures.noSelection") }}</p>
              </section>
            </section>
            <AppEmptyState v-else :title="t('gestures.emptyIntents')" />
          </div>
        </template>

        <template #review>
          <section class="template-detail__review" aria-labelledby="template-detail-review-title">
        <header class="template-detail__review-head">
          <div class="template-detail__review-title" :class="{ 'is-elevated': hasElevatedRisk }">
            <ShieldCheck v-if="!hasElevatedRisk" :size="18" aria-hidden="true" />
            <TriangleAlert v-else :size="18" aria-hidden="true" />
            <div>
              <span class="template-detail__section-kicker">{{ t("templates.risk.all") }}</span>
              <h3 id="template-detail-review-title">{{ t(hasElevatedRisk ? "templates.risk.elevated" : "templates.risk.low") }}</h3>
            </div>
          </div>
          <AppBadge :variant="hasElevatedRisk ? 'warning' : 'success'">
            {{ t(hasElevatedRisk ? "templates.risk.elevated" : "templates.risk.low") }}
          </AppBadge>
        </header>

        <div class="template-detail__review-notices">
          <AppAlert
            v-if="riskyIntents.length"
            variant="warning"
            :title="t('templates.risk.warningTitle', { count: riskyIntents.length })"
          >
            <ul class="template-detail__risk-list">
              <li v-for="(risk, index) in riskyIntents" :key="`${risk.target.scope}-${index}-${risk.intent.name}`">
                {{ targetName(risk.target) }} · {{ risk.intent.name }} - {{ t(`command.types.${risk.intent.command.type}`) }}
              </li>
            </ul>
          </AppAlert>
          <AppAlert v-else-if="!hasPluginInstall" variant="success" :title="t('templates.risk.lowDescription')" />

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
        </div>

        <div v-if="templates.adoptionPlan" class="template-detail__adoption">
          <div class="template-detail__stats">
            <span>{{ t("templates.adoption.added", { count: templates.adoptionPlan.stats.added }) }}</span>
            <span>{{ t("templates.adoption.replaced", { count: templates.adoptionPlan.stats.replaced }) }}</span>
            <span>{{ t("templates.adoption.skipped", { count: templates.adoptionPlan.stats.skipped }) }}</span>
          </div>

          <section v-if="templates.adoptionPlan.conflicts.length" class="template-detail__conflicts">
            <div class="template-detail__conflict-heading">
              <div>
                <h3>{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</h3>
              </div>
              <TriangleAlert :size="17" aria-hidden="true" />
            </div>
            <ul>
              <li v-for="(conflict, index) in templates.adoptionPlan.conflicts" :key="`${gestureIdentityKey(conflict.gesture)}-${index}`">
                <MnemonicText :gesture="conflict.gesture" />
                <span>{{ conflict.templateName }} / {{ conflict.existingNames.join(", ") }}</span>
              </li>
            </ul>
            <fieldset class="template-detail__conflict-policy">
              <legend class="gg-sr-only">{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</legend>
              <label :class="{ 'is-selected': templates.conflictPolicy === 'keepExisting' }">
                <input
                  :checked="templates.conflictPolicy === 'keepExisting'"
                  type="radio"
                  name="template-conflict-policy"
                  value="keepExisting"
                  @change="templates.setConflictPolicy('keepExisting')"
                />
                <span>{{ t("templates.adoption.keepExisting") }}</span>
              </label>
              <label :class="{ 'is-selected': templates.conflictPolicy === 'replaceExisting' }">
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

        </div>
          </section>

          <AppAlert v-if="templates.adoptionError" variant="error" :title="errorText(templates.adoptionError)" />
        </template>
      </AppTabs>
    </template>

    <template #footer>
      <label v-if="hasElevatedRisk" class="template-detail__risk-confirm">
        <input v-model="riskConfirmed" type="checkbox" />
        <span>{{ t("templates.risk.confirm") }}</span>
      </label>
      <AppButton :disabled="templates.adopting" @click="requestClose">{{ t("common.cancel") }}</AppButton>
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
</template>

<style scoped>
:deep(.template-detail) {
  width: min(100%, 750px);
  height: min(720px, calc(100dvh - 60px));
  max-height: min(760px, calc(100dvh - 28px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:deep(.template-detail .gg-dialog__header) {
  min-height: 64px;
  padding: 0 20px 0 24px;
  background: var(--gg-surface-muted);
}

:deep(.template-detail .gg-dialog__title) {
  font-size: 18px;
}

:deep(.template-detail .gg-dialog__body) {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 20px 18px;
}

:deep(.template-detail .gg-dialog__footer) {
  min-height: 64px;
  align-items: center;
  padding: 12px 20px 16px;
}

.template-detail__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  padding: 18px 0 16px;
  border-bottom: 1px solid var(--gg-border);
}

.template-detail__hero-copy,
.template-detail__hero-metrics {
  min-width: 0;
}

.template-detail__eyebrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--gg-text-muted);
  font-size: 12px;
}

.template-detail__eyebrow code {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--gg-border);
  border-radius: 4px;
  padding: 3px 7px;
  background: var(--gg-surface-muted);
  color: var(--gg-text-muted);
  font: 11px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.template-detail__hero-summary {
  max-width: 620px;
  margin: 10px 0 0;
  color: var(--gg-text);
  font-size: 14px;
  line-height: 1.55;
}

.template-detail__hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 11px;
}

.template-detail__hero-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(72px, 1fr));
  align-self: stretch;
  gap: 10px;
  border-left: 1px solid var(--gg-border);
  padding-left: 20px;
}

.template-detail__metric {
  display: flex;
  min-width: 72px;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  color: var(--gg-text-muted);
  font-size: 12px;
  text-align: center;
}

.template-detail__metric strong {
  color: var(--gg-primary);
  font-size: 26px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.template-detail__workspace {
  display: grid;
  grid-template-columns: 204px minmax(0, 1fr);
  height: 369px;
  min-height: 0;
  margin-top: 16px;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--gg-surface);
}

.template-detail__apps {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--gg-border);
  background: var(--gg-surface-muted);
}

.template-detail__apps-head,
.template-detail__toolbar {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--gg-border);
  padding: 0 12px;
  color: var(--gg-text-muted);
  font-size: 12px;
}

.template-detail__section-label,
.template-detail__command-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--gg-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.template-detail__section-label svg,
.template-detail__command-label svg {
  color: var(--gg-primary);
}

.template-detail__apps-count,
.template-detail__app-count,
.template-detail__count {
  color: var(--gg-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.template-detail__app-list {
  min-height: 0;
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  list-style: none;
}

.template-detail__app-item {
  position: relative;
}

.template-detail__app-button {
  width: 100%;
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--gg-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}

.template-detail__app-button:hover {
  border-color: var(--gg-border);
  background: var(--gg-surface-hover);
}

.template-detail__app-button:focus-visible {
  outline: 2px solid var(--gg-ring);
  outline-offset: -2px;
}

.template-detail__app-item.is-active .template-detail__app-button {
  border-color: var(--gg-primary-border);
  color: var(--gg-primary);
  background: var(--gg-primary-soft);
  box-shadow: inset 3px 0 0 var(--gg-primary);
}

.template-detail__app-identity,
.template-detail__app-copy {
  display: flex;
  min-width: 0;
}

.template-detail__app-identity {
  flex: 1;
  align-items: center;
  gap: 9px;
}

.template-detail__app-copy {
  flex-direction: column;
  gap: 2px;
}

.template-detail__app-name,
.template-detail__app-binding {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-detail__app-name {
  font-size: 13px;
  font-weight: 600;
}

.template-detail__app-binding {
  color: var(--gg-text-muted);
  font-size: 11px;
}

.template-detail__main {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(170px, 1fr) minmax(185px, .95fr);
  gap: 0;
  padding: 0;
  background: var(--gg-surface);
}

.template-detail__main-head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.template-detail__main-head h3 {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
}

.template-detail__main-head p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.template-detail__table-pane,
.template-detail__editor-pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 7px;
  background: var(--gg-surface);
}

.template-detail__table-pane {
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr);
}

.template-detail__table-scroll {
  min-width: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.template-detail__table {
  width: 100%;
  min-width: 560px;
  border-collapse: collapse;
  font-size: 12px;
}

.template-detail__table th,
.template-detail__table td {
  border-bottom: 1px solid var(--gg-border);
  padding: 8px 9px;
  text-align: left;
  vertical-align: middle;
}

.template-detail__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--gg-text-muted);
  background: var(--gg-surface-muted);
  font-size: 11px;
  font-weight: 650;
}

.template-detail__table tbody tr {
  cursor: pointer;
  transition: background-color 150ms ease;
}

.template-detail__table tbody tr:hover {
  background: var(--gg-surface-hover);
}

.template-detail__table tbody tr.is-selected {
  background: var(--gg-primary-soft);
  box-shadow: inset 3px 0 0 var(--gg-primary);
}

.template-detail__table tbody tr.is-conflict td {
  color: var(--gg-warning);
}

.template-detail__editor-pane {
  overflow-y: auto;
  padding: 14px;
  scrollbar-gutter: stable;
}

.template-detail__main > :deep(.gesture-action-table),
.template-detail__main > .template-detail__editor-pane {
  border-radius: 0;
}

.template-detail__main > :deep(.gesture-action-table) {
  border: 0;
}

.template-detail__main > .template-detail__editor-pane {
  border: 0;
  border-top: 1px solid var(--gg-border);
}

.template-detail__intent-editor {
  display: grid;
  min-width: 0;
  gap: 14px;
}

.template-detail__editor-head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--gg-border);
}

.template-detail__section-kicker {
  display: block;
  margin-bottom: 3px;
  color: var(--gg-text-muted);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
}

.template-detail__editor-head h4 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.3;
}

.template-detail__intent-summary {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(130px, .8fr);
  gap: 12px;
}

.template-detail__readonly-value {
  display: flex;
  min-height: 34px;
  align-items: center;
  border: 1px solid var(--gg-border);
  border-radius: 5px;
  padding: 0 10px;
  overflow-wrap: anywhere;
  color: var(--gg-text);
  background: var(--gg-surface-muted);
}

.template-detail__editor-mnemonic {
  min-height: 34px;
  font-size: 20px;
}

.template-detail__command-preview {
  display: grid;
  gap: 7px;
}

.template-detail__command-label {
  color: var(--gg-text);
}

.template-detail__command-value {
  display: flex;
  min-width: 0;
  min-height: 52px;
  align-items: flex-start;
  border: 1px solid var(--gg-border);
  border-radius: 5px;
  padding: 10px 11px;
  background: var(--gg-surface-muted);
}

.template-detail__command-value code {
  display: block;
  max-width: 100%;
  overflow: auto;
  color: var(--gg-text);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.template-detail__review {
  display: grid;
  gap: 12px;
}

.template-detail__review-head,
.template-detail__review-title,
.template-detail__conflict-heading {
  display: flex;
  align-items: center;
}

.template-detail__review-head {
  justify-content: space-between;
  gap: 14px;
}

.template-detail__review-title {
  min-width: 0;
  gap: 9px;
}

.template-detail__review-title > svg {
  flex: 0 0 auto;
  color: var(--gg-success);
}

.template-detail__review-title.is-elevated > svg {
  color: var(--gg-warning);
}

.template-detail__review-title h3 {
  margin: 0;
  font-size: 14px;
}

.template-detail__review-notices {
  display: grid;
  gap: 8px;
}

.template-detail__review-notices :deep(.gg-alert) {
  margin: 0;
}

.template-detail__risk-list {
  display: grid;
  gap: 3px;
  margin: 6px 0 0;
  padding-left: 17px;
  line-height: 1.45;
}

.template-detail__adoption {
  display: grid;
  gap: 12px;
}

.template-detail__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.template-detail__stats span {
  min-width: 0;
  border: 1px solid var(--gg-border);
  border-radius: 5px;
  padding: 8px 10px;
  color: var(--gg-text);
  background: var(--gg-surface-muted);
  font-size: 12px;
  text-align: center;
}

.template-detail__conflicts {
  border: 1px solid var(--gg-warning-border);
  border-radius: 7px;
  padding: 12px;
  background: var(--gg-warning-soft);
}

.template-detail__conflict-heading {
  justify-content: space-between;
  gap: 12px;
}

.template-detail__conflict-heading h3 {
  margin: 0;
  color: var(--gg-text);
  font-size: 14px;
}

.template-detail__conflict-heading > svg {
  flex: 0 0 auto;
  color: var(--gg-warning);
}

.template-detail__conflicts ul {
  display: grid;
  gap: 5px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  color: var(--gg-text);
  font-size: 12px;
}

.template-detail__conflicts li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--gg-warning-border);
}

.template-detail__conflicts li:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.template-detail__conflict-policy {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  border: 0;
}

.template-detail__conflict-policy label {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--gg-border);
  border-radius: 5px;
  padding: 0 9px;
  color: var(--gg-text);
  background: var(--gg-surface);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.template-detail__conflict-policy label:hover,
.template-detail__conflict-policy label.is-selected {
  border-color: var(--gg-primary);
  background: var(--gg-primary-soft);
}

.template-detail__conflict-policy input,
.template-detail__risk-confirm input {
  accent-color: var(--gg-primary);
}

.template-detail__risk-confirm {
  display: flex;
  width: fit-content;
  min-height: 36px;
  align-items: center;
  margin-right: auto;
  gap: 8px;
  border: 1px solid var(--gg-warning-border);
  border-radius: 5px;
  padding: 0 10px;
  color: var(--gg-text);
  background: var(--gg-warning-soft);
  font-size: 12px;
  cursor: pointer;
}

.template-detail__review + .gg-alert {
  margin-top: 12px;
}
:global(.template-detail) {
  width: min(100%, 750px);
  height: min(720px, calc(100dvh - 60px));
  max-height: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:global(.template-detail .gg-dialog__body) {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-top: 0;
}

.template-detail__sections { min-width: 0; margin-top: 16px; }
:deep(.template-detail__sections > .gg-tabs__panel) {
  min-height: 0;
  padding-top: 0;
}
.template-detail__sections :deep(.template-detail__workspace),
.template-detail__sections :deep(.template-detail__review) { margin-top: 0; }
</style>
