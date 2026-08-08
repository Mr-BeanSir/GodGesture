<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, Refresh, Search } from "@element-plus/icons-vue";
import {
  commandTemplateRisks,
  gestureIdentityKey,
  type GestureTemplateCatalogEntry,
  type GestureTemplateIntent,
} from "@godgesture/shared";
import { useTemplatesStore } from "../stores/templates";
import AppIcon from "../components/AppIcon.vue";
import MnemonicText from "../components/MnemonicText.vue";

const { t } = useI18n();
const templates = useTemplatesStore();
const riskConfirmed = ref(false);

const detailVisible = computed({
  get: () => templates.selectedEntry !== null,
  set: (visible) => {
    if (!visible) templates.closeDetails();
  },
});
const selectedTargetIndex = ref(0);
const selectedIntentIndex = ref(0);
const packageTargets = computed(
  () => templates.selectedPackage?.targets ?? [],
);
const selectedTarget = computed(
  () => packageTargets.value[selectedTargetIndex.value] ?? packageTargets.value[0] ?? null,
);
const packageIntents = computed(
  () => selectedTarget.value?.intents ?? [],
);
const templateIntentRows = computed(() =>
  packageIntents.value.map((intent, index) => ({
    key: `${selectedTargetIndex.value}:${index}`,
    index,
    name: intent.name,
    intent,
  })),
);
const selectedTemplateIntent = computed<GestureTemplateIntent | null>(
  () => packageIntents.value[selectedIntentIndex.value] ?? packageIntents.value[0] ?? null,
);
const conflictKeys = computed(
  () => new Set(
    (templates.adoptionPlan?.conflicts ?? []).map((conflict) =>
      gestureIdentityKey(conflict.gesture),
    ),
  ),
);
const riskyIntents = computed(() =>
  packageTargets.value.flatMap((target) =>
    target.intents
      .filter((intent) => commandTemplateRisks(intent.command).length > 0)
      .map((intent) => ({ target, intent })),
  ),
);
const hasPluginInstall = computed(
  () => (templates.adoptionPlan?.pluginSources.length ?? 0) > 0,
);
const hasElevatedRisk = computed(
  () => riskyIntents.value.length > 0 || hasPluginInstall.value,
);

watch(
  () => templates.selectedEntry,
  () => {
    riskConfirmed.value = false;
    selectedTargetIndex.value = 0;
    selectedIntentIndex.value = 0;
  },
);

watch(packageTargets, (targets) => {
  if (selectedTargetIndex.value >= targets.length) selectedTargetIndex.value = 0;
  if (selectedIntentIndex.value >= (selectedTarget.value?.intents.length ?? 0)) {
    selectedIntentIndex.value = 0;
  }
});

onMounted(() => {
  void templates.loadCatalog();
});

function localized(value: string) {
  return value;
}

function entryScope(entry: GestureTemplateCatalogEntry): "global" | "app" | "mixed" {
  const scopes = new Set(entry.targets.map((target) => target.scope));
  return scopes.size > 1 ? "mixed" : [...scopes][0] ?? "app";
}

function targetName(target: (typeof packageTargets.value)[number]): string {
  return target.scope === "global" ? t("gestures.globalApp") : target.name;
}

function targetBinding(target: (typeof packageTargets.value)[number]): string[] {
  if (target.scope === "global") return [];
  return [
    target.windows?.exeName,
    target.mac?.bundleId,
  ].filter((value): value is string => Boolean(value));
}

function selectTarget(index: number) {
  selectedTargetIndex.value = index;
  selectedIntentIndex.value = 0;
}

function selectTemplateIntent(row: { index: number }) {
  selectedIntentIndex.value = row.index;
}

function templateRowClass({ row }: { row: { index: number; intent: GestureTemplateIntent } }) {
  return [
    row.index === selectedIntentIndex.value ? "is-selected" : "",
    hasConflict(row.intent) ? "is-conflict" : "",
  ].filter(Boolean).join(" ");
}

function hasConflict(intent: GestureTemplateIntent): boolean {
  return conflictKeys.value.has(gestureIdentityKey(intent.gesture));
}

function commandPreview(intent: GestureTemplateIntent): string {
  const command = intent.command;
  switch (command.type) {
    case "doNothing":
      return t("command.doNothing.desc");
    case "hotKey":
      return [...command.modifiers, ...command.keys].join(" + ");
    case "webSearch":
      return command.engineName;
    case "windowControl":
      return t(`command.windowControl.operations.${command.operation}`);
    case "taskSwitcher":
      return t("command.taskSwitcher.desc");
    case "openFile":
      return command.path;
    case "sendText":
      return command.text;
    case "gotoUrl":
      return command.url;
    case "cmd":
    case "powershell":
      return command.code;
    case "nodePlugin":
      return command.pluginId;
    case "audioVolume":
      return `${command.delta > 0 ? "+" : ""}${command.delta}%`;
  }
}

function openDetails(entry: GestureTemplateCatalogEntry) {
  riskConfirmed.value = false;
  void templates.openDetails(entry);
}

function errorText(code: string) {
  const key = `templates.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("templates.errors.unknown") : translated;
}


async function confirmAdoption() {
  const plan = templates.adoptionPlan;
  if (!plan || (hasElevatedRisk.value && !riskConfirmed.value)) return;
  try {
    await ElMessageBox.confirm(
      t("templates.adoption.confirmBody", {
        ...plan.stats,
        plugins: plan.pluginSources.length,
      }),
      t("templates.adoption.confirmTitle"),
      {
        type: hasElevatedRisk.value ? "warning" : "info",
        confirmButtonText: t("templates.adoption.apply"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  if (await templates.adopt()) {
    ElMessage.success(t("templates.adoption.success"));
  }
}
</script>

<template>
  <div class="templates-view">
    <header class="templates-view__header">
      <div>
        <h2>{{ t("templates.title") }}</h2>
        <p class="gg-hint">{{ t("templates.subtitle") }}</p>
      </div>
      <div class="templates-view__actions">
        <el-tooltip :content="t('templates.refresh')" placement="bottom">
          <el-button
            circle
            :icon="Refresh"
            :loading="templates.loadingCatalog"
            :aria-label="t('templates.refresh')"
            @click="templates.loadCatalog(true)"
          />
        </el-tooltip>
      </div>
    </header>

    <div class="templates-view__filters">
      <el-input
        v-model="templates.query"
        clearable
        :prefix-icon="Search"
        :placeholder="t('templates.searchPlaceholder')"
      />
      <el-radio-group v-model="templates.scopeFilter" size="small">
        <el-radio-button value="all">{{ t("templates.scope.all") }}</el-radio-button>
        <el-radio-button value="global">{{ t("templates.scope.global") }}</el-radio-button>
        <el-radio-button value="app">{{ t("templates.scope.app") }}</el-radio-button>
      </el-radio-group>
      <el-select v-model="templates.riskFilter" class="templates-view__risk-filter">
        <el-option :label="t('templates.risk.all')" value="all" />
        <el-option :label="t('templates.risk.low')" value="low" />
        <el-option :label="t('templates.risk.elevated')" value="elevated" />
      </el-select>
    </div>

    <el-alert
      v-if="templates.catalogError"
      type="error"
      show-icon
      :closable="false"
      :title="errorText(templates.catalogError)"
    >
      <template #default>
        <div class="templates-view__error-actions">
          <el-button link type="primary" :icon="Refresh" @click="templates.loadCatalog(true)">
            {{ t("common.retry") }}
          </el-button>
        </div>
      </template>
    </el-alert>

    <div v-else class="templates-view__list">
      <el-skeleton v-if="templates.loadingCatalog" :rows="4" animated />
      <el-empty
        v-else-if="templates.filteredEntries.length === 0"
        :description="t(templates.entries.length ? 'templates.emptyFiltered' : 'templates.emptyCatalog')"
      />
      <template v-else>
        <button
          v-for="entry in templates.filteredEntries"
          :key="`${entry.id}@${entry.versionNumber}`"
          type="button"
          class="templates-view__row"
          @click="openDetails(entry)"
        >
          <span class="templates-view__row-main">
            <span class="templates-view__row-title">
              {{ localized(entry.title) }}
              <el-tag size="small" effect="plain" disable-transitions>v{{ entry.versionNumber }}</el-tag>
            </span>
            <span class="templates-view__summary">{{ localized(entry.summary) }}</span>
            <span class="templates-view__tags">
              <el-tag
                v-for="tag in entry.tags"
                :key="tag"
                size="small"
                type="info"
                disable-transitions
              >
                {{ tag }}
              </el-tag>
            </span>
          </span>
          <span class="templates-view__row-meta">
            <el-tag
              size="small"
              :type="entryScope(entry) === 'global' ? 'primary' : entryScope(entry) === 'mixed' ? 'warning' : 'success'"
              disable-transitions
            >
              {{ t(`templates.scope.${entryScope(entry)}`) }}
            </el-tag>
            <el-tag
              size="small"
              :type="entry.risks.length ? 'warning' : 'info'"
              disable-transitions
            >
              {{ t(entry.risks.length ? "templates.risk.elevated" : "templates.risk.low") }}
            </el-tag>
            <span>{{ entry.author }}</span>
          </span>
        </button>
      </template>
    </div>

    <el-dialog
      v-model="detailVisible"
      class="template-detail"
      :title="templates.selectedEntry ? localized(templates.selectedEntry.title) : ''"
      width="min(860px, calc(100vw - 32px))"
      top="4vh"
      destroy-on-close
      :close-on-click-modal="!templates.adopting"
      :close-on-press-escape="!templates.adopting"
      :show-close="!templates.adopting"
    >
      <el-skeleton v-if="templates.loadingPackage" :rows="7" animated />
      <el-result
        v-else-if="templates.packageError"
        icon="error"
        :title="t('templates.packageLoadFailed')"
        :sub-title="errorText(templates.packageError)"
      >
        <template #extra>
          <el-button
            type="primary"
            :icon="Refresh"
            @click="templates.selectedEntry && templates.openDetails(templates.selectedEntry)"
          >
            {{ t("common.retry") }}
          </el-button>
        </template>
      </el-result>
      <template v-else-if="templates.selectedEntry && templates.selectedPackage">
        <header class="template-detail__hero">
          <div class="template-detail__hero-copy">
            <div class="template-detail__eyebrow">
              <code>{{ templates.selectedEntry.id }}</code>
              <el-tag size="small" effect="plain">v{{ templates.selectedEntry.versionNumber }}</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ templates.selectedEntry.author }}</el-tag>
            </div>
            <h3>{{ localized(templates.selectedEntry.title) }}</h3>
            <p>{{ localized(templates.selectedEntry.summary) }}</p>
          </div>
          <div class="template-detail__hero-targets">
            <strong>{{ templates.selectedPackage.targets.length }}</strong>
            <span>{{ t("templates.detail.targets") }}</span>
          </div>
        </header>

        <div class="template-detail__workspace">
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
            <header class="template-detail__main-head">
              <div>
                <h3>{{ targetName(selectedTarget) }}</h3>
                <p class="gg-hint">
                  {{ targetBinding(selectedTarget).join(" · ") || t("templates.detail.globalTarget") }}
                </p>
              </div>
              <el-tag size="small" effect="plain">
                {{ t("templates.detail.gestures", { count: selectedTarget.intents.length }) }}
              </el-tag>
            </header>

            <section class="template-detail__table-pane">
              <div class="template-detail__toolbar">
                <span class="template-detail__count">{{ templateIntentRows.length }}</span>
              </div>
              <div class="template-detail__table-body">
                <el-table
                  v-if="templateIntentRows.length"
                  :data="templateIntentRows"
                  :row-class-name="templateRowClass"
                  height="100%"
                  size="small"
                  class="template-detail__table"
                  @row-click="selectTemplateIntent"
                >
                  <el-table-column :label="t('gestures.colKind')" width="76">
                    <template #default>
                      <el-tag size="small" type="info">{{ t("gestures.gestureKind") }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="t('gestures.colName')"
                    prop="name"
                    min-width="100"
                    show-overflow-tooltip
                  />
                  <el-table-column :label="t('gestures.colMnemonic')" min-width="88">
                    <template #default="{ row }">
                      <MnemonicText :gesture="row.intent.gesture" />
                    </template>
                  </el-table-column>
                  <el-table-column
                    :label="t('gestures.colCommand')"
                    min-width="96"
                    show-overflow-tooltip
                  >
                    <template #default="{ row }">
                      {{ t(`command.types.${row.intent.command.type}`) }}
                    </template>
                  </el-table-column>
                  <el-table-column :label="t('gestures.colStatus')" width="92" align="center">
                    <template #default="{ row }">
                      <el-tag
                        size="small"
                        effect="plain"
                        :type="hasConflict(row.intent) ? 'warning' : 'success'"
                      >
                        {{ t(hasConflict(row.intent) ? "templates.detail.conflict" : "templates.detail.noConflict") }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
                <el-empty v-else :description="t('gestures.emptyIntents')" :image-size="64" />
              </div>
            </section>

            <section class="template-detail__editor-pane gestures__editor-pane">
              <template v-if="selectedTemplateIntent">
                <div class="template-detail__intent-editor">
                  <div class="template-detail__intent-summary">
                    <div class="gg-field">
                      <label class="gg-field-label">{{ t("gestures.intentName") }}</label>
                      <div class="template-detail__readonly-value">{{ selectedTemplateIntent.name }}</div>
                    </div>
                    <div class="gg-field">
                      <label class="gg-field-label">{{ t("gestures.colMnemonic") }}</label>
                      <MnemonicText :gesture="selectedTemplateIntent.gesture" class="template-detail__editor-mnemonic" />
                    </div>
                    <div class="gg-field">
                      <label class="gg-field-label">{{ t("gestures.modifier") }}</label>
                      <div class="template-detail__readonly-value">
                        {{ t(`modifier.${selectedTemplateIntent.gesture.modifier}`) }}
                      </div>
                    </div>
                  </div>
                  <div class="gg-field template-detail__command-preview">
                    <label class="gg-field-label">{{ t("gestures.editorTitle") }}</label>
                    <div class="template-detail__command-value">
                      <el-tag size="small" type="info">
                        {{ t(`command.types.${selectedTemplateIntent.command.type}`) }}
                      </el-tag>
                      <code v-if="commandPreview(selectedTemplateIntent)">{{ commandPreview(selectedTemplateIntent) }}</code>
                    </div>
                  </div>
                </div>
              </template>
              <p v-else class="gg-hint">{{ t("gestures.noSelection") }}</p>
            </section>
          </section>
        </div>

        <el-alert
          v-if="hasElevatedRisk"
          type="warning"
          show-icon
          :closable="false"
          :title="t('templates.risk.warningTitle', { count: riskyIntents.length })"
        >
          <ul class="template-detail__risk-list">
            <li v-for="(risk, index) in riskyIntents" :key="`${risk.target.scope}-${index}-${risk.intent.name}`">
              {{ targetName(risk.target) }} · {{ risk.intent.name }} - {{ t(`command.types.${risk.intent.command.type}`) }}
            </li>
          </ul>
        </el-alert>
        <el-alert
          v-else
          type="success"
          show-icon
          :closable="false"
          :title="t('templates.risk.lowDescription')"
        />

        <el-alert
          v-if="templates.adoptionPlan?.pluginSources.length"
          class="template-detail__plugin-warning"
          type="warning"
          show-icon
          :closable="false"
          :title="t('templates.adoption.plugins', { count: templates.adoptionPlan.pluginSources.length })"
        >
          <ul class="template-detail__risk-list">
            <li v-for="source in templates.adoptionPlan.pluginSources" :key="source.pluginId">
              <code>{{ source.pluginId }}<template v-if="source.subdirectory"> / {{ source.subdirectory }}</template></code>
            </li>
          </ul>
        </el-alert>

        <div v-if="templates.adoptionPlan" class="template-detail__adoption">
          <div v-if="templates.adoptionPlan.conflicts.length" class="template-detail__conflicts">
            <h3>{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</h3>
            <ul>
              <li
                v-for="(conflict, index) in templates.adoptionPlan.conflicts"
                :key="`${gestureIdentityKey(conflict.gesture)}-${index}`"
              >
                <MnemonicText :gesture="conflict.gesture" />
                {{ conflict.templateName }} / {{ conflict.existingNames.join(", ") }}
              </li>
            </ul>
            <el-radio-group
              :model-value="templates.conflictPolicy"
              size="small"
              @update:model-value="templates.setConflictPolicy($event as 'keepExisting' | 'replaceExisting')"
            >
              <el-radio-button value="keepExisting">{{ t("templates.adoption.keepExisting") }}</el-radio-button>
              <el-radio-button value="replaceExisting">{{ t("templates.adoption.replaceExisting") }}</el-radio-button>
            </el-radio-group>
          </div>

          <div class="template-detail__stats">
            <span>{{ t("templates.adoption.added", { count: templates.adoptionPlan.stats.added }) }}</span>
            <span>{{ t("templates.adoption.replaced", { count: templates.adoptionPlan.stats.replaced }) }}</span>
            <span>{{ t("templates.adoption.skipped", { count: templates.adoptionPlan.stats.skipped }) }}</span>
          </div>
          <el-checkbox v-if="hasElevatedRisk" v-model="riskConfirmed">
            {{ t("templates.risk.confirm") }}
          </el-checkbox>
        </div>

        <el-alert
          v-if="templates.adoptionError"
          type="error"
          show-icon
          :closable="false"
          :title="errorText(templates.adoptionError)"
        />
      </template>

      <template #footer>
        <el-button :disabled="templates.adopting" @click="detailVisible = false">
          {{ t("common.cancel") }}
        </el-button>
        <el-button
          type="primary"
          :icon="Download"
          :loading="templates.adopting"
          :disabled="!templates.adoptionPlan || (hasElevatedRisk && !riskConfirmed)"
          @click="confirmAdoption"
        >
          {{ t("templates.adoption.apply") }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.templates-view {
  width: min(100%, 920px);
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;
}
.templates-view__header,
.template-detail__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.templates-view__actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
}
.templates-view__header h2,
.template-detail__section-head h3,
.template-detail__conflicts h3 {
  margin: 0;
  font-size: 16px;
}
.templates-view__header p {
  margin-top: 5px;
}
.templates-view__filters {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto 150px;
  gap: 10px;
  align-items: center;
}
.templates-view__list {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  border-top: 1px solid var(--el-border-color-lighter);
}
.templates-view__row {
  width: 100%;
  min-height: 94px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  padding: 13px 8px;
  border: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--gg-surface);
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
}
.templates-view__row:hover,
.templates-view__row:focus-visible {
  background: var(--el-fill-color-light);
  outline: none;
}
.templates-view__row:focus-visible {
  box-shadow: 0 0 0 2px var(--el-color-primary) inset;
}
.templates-view__row-main,
.templates-view__row-meta,
.templates-view__tags {
  display: flex;
}
.templates-view__row-main {
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}
.templates-view__row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.templates-view__summary {
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.45;
}
.templates-view__tags {
  flex-wrap: wrap;
  gap: 5px;
}
.templates-view__row-meta {
  width: 128px;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.templates-view__error-actions {
  margin-top: 4px;
}
.template-detail__hero {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.template-detail__hero-copy {
  min-width: 0;
}
.template-detail__eyebrow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.template-detail__eyebrow code {
  color: var(--el-text-color-regular);
}
.template-detail__hero h3 {
  margin: 0;
  font-size: 20px;
  line-height: 1.25;
}
.template-detail__hero p {
  margin: 6px 0 0;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}
.template-detail__hero-targets {
  display: flex;
  flex: 0 0 86px;
  flex-direction: column;
  justify-content: center;
  align-items: flex-end;
  color: var(--el-text-color-secondary);
  text-align: right;
}
.template-detail__hero-targets strong {
  color: var(--el-color-primary);
  font-size: 26px;
  line-height: 1;
}
.template-detail__hero-targets span {
  margin-top: 6px;
  font-size: 12px;
}
.template-detail__workspace {
  display: grid;
  grid-template-columns: clamp(184px, 22vw, 224px) minmax(0, 1fr);
  min-height: 500px;
  margin-top: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
}
.template-detail__apps {
  min-width: 0;
  min-height: 0;
  background: var(--gg-surface);
  border-right: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.template-detail__apps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.template-detail__apps-count,
.template-detail__app-count {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.template-detail__app-list {
  list-style: none;
  min-height: 0;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
}
.template-detail__app-item {
  min-width: 0;
  margin: 0;
  border-radius: var(--el-border-radius-base);
}
.template-detail__app-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 38px;
  padding: 5px 7px;
  border: 0;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-regular);
  text-align: left;
  cursor: pointer;
}
.template-detail__app-button:hover,
.template-detail__app-button:focus-visible {
  background: var(--el-fill-color);
  outline: none;
}
.template-detail__app-item.is-active .template-detail__app-button {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.template-detail__app-identity {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 8px;
}
.template-detail__app-copy {
  display: flex;
  min-width: 0;
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
}
.template-detail__app-binding {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.template-detail__app-item.is-active .template-detail__app-name {
  font-weight: 600;
}
.template-detail__app-count {
  flex: 0 0 auto;
}
.template-detail__main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(150px, 0.9fr) minmax(190px, 1.1fr);
  gap: 10px;
  padding: 10px;
  background: var(--el-bg-color);
}
.template-detail__main-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.template-detail__main-head h3 {
  margin: 0;
  font-size: 15px;
}
.template-detail__main-head p {
  max-width: 100%;
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.template-detail__table-pane,
.template-detail__editor-pane {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  overflow: hidden;
}
.template-detail__table-pane {
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr);
}
.template-detail__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.template-detail__count {
  min-width: 24px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.template-detail__table-body {
  min-height: 0;
}
.template-detail__table {
  width: 100%;
}
.template-detail__table :deep(.is-selected) {
  background: var(--el-color-primary-light-9);
}
.template-detail__table :deep(tr) {
  cursor: pointer;
}
.template-detail__table :deep(.is-conflict) {
  color: var(--el-color-warning);
}
.template-detail__editor-pane {
  padding: 12px 14px;
  overflow-y: auto;
}
.template-detail__intent-editor {
  display: grid;
  min-width: 0;
  gap: 16px;
}
.template-detail__intent-summary {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(150px, 1.35fr) minmax(150px, 1fr) minmax(100px, 0.8fr);
  gap: 12px 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.template-detail__readonly-value {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.template-detail__editor-mnemonic {
  min-height: 32px;
  font-size: 20px;
}
.template-detail__command-preview {
  min-width: 0;
}
.template-detail__command-value {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  gap: 8px;
}
.template-detail__command-value code {
  display: block;
  max-width: 100%;
  overflow: auto;
  color: var(--el-text-color-regular);
  font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.template-detail__risk-list,
.template-detail__conflicts ul {
  margin: 5px 0 0;
  padding-left: 18px;
  line-height: 1.5;
}
.template-detail__section-head {
  margin: 15px 0 8px;
}
.template-detail__adoption {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.template-detail__conflicts {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
}
.template-detail__conflicts h3 {
  font-size: 14px;
}
.template-detail__conflicts ul {
  font-size: 12px;
}
.template-detail__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
:deep(.template-detail .el-dialog__body) {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}
@media (max-width: 720px) {
  .templates-view__filters {
    grid-template-columns: 1fr;
  }
  .templates-view__risk-filter {
    width: 100%;
  }
  .templates-view__row {
    grid-template-columns: 1fr;
  }
  .templates-view__row-meta {
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .template-detail__hero {
    flex-direction: column;
    gap: 12px;
  }
  .template-detail__hero-targets {
    flex-basis: auto;
    align-items: flex-start;
    text-align: left;
  }
  .template-detail__workspace {
    grid-template-columns: 1fr;
    min-height: 0;
  }
  .template-detail__apps {
    max-height: 174px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
  .template-detail__app-list {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .template-detail__app-item {
    flex: 0 0 190px;
  }
  .template-detail__main {
    min-height: 540px;
  }
  .template-detail__intent-summary {
    grid-template-columns: 1fr;
  }
}
</style>
