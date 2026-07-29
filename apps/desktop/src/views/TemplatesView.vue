<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, Link, Refresh, Search } from "@element-plus/icons-vue";
import {
  commandTemplateRisks,
  type GestureTemplateCatalogEntry,
} from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useTemplatesStore } from "../stores/templates";
import { gestureMnemonic } from "../utils/mnemonic";

const DEFAULT_TEMPLATE_REPOSITORY_URL =
  "https://github.com/Mr-BeanSir/gesture-templates";

const { t, locale } = useI18n();
const backend = useBackend();
const templates = useTemplatesStore();
const riskConfirmed = ref(false);

const repositoryUrl =
  import.meta.env.VITE_GESTURE_TEMPLATE_REPOSITORY_URL?.trim() ||
  DEFAULT_TEMPLATE_REPOSITORY_URL;
const detailVisible = computed({
  get: () => templates.selectedEntry !== null,
  set: (visible) => {
    if (!visible) templates.closeDetails();
  },
});
const packageIntents = computed(
  () => templates.selectedPackage?.target.intents ?? [],
);
const riskyIntents = computed(() =>
  packageIntents.value.filter(
    (intent) => commandTemplateRisks(intent.command).length > 0,
  ),
);
const hasElevatedRisk = computed(() => riskyIntents.value.length > 0);

watch(
  () => templates.selectedEntry,
  () => {
    riskConfirmed.value = false;
  },
);

onMounted(() => {
  void templates.loadCatalog();
});

function localized(value: { "zh-CN": string; en: string }) {
  return locale.value === "zh-CN" ? value["zh-CN"] : value.en;
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

function openRepository() {
  void backend.openExternal(repositoryUrl);
}

async function confirmAdoption() {
  const plan = templates.adoptionPlan;
  if (!plan || (hasElevatedRisk.value && !riskConfirmed.value)) return;
  try {
    await ElMessageBox.confirm(
      t("templates.adoption.confirmBody", plan.stats),
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
      <el-tooltip :content="t('templates.repository')" placement="bottom">
        <el-button circle :icon="Link" @click="openRepository" />
      </el-tooltip>
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
          <el-button link :icon="Link" @click="openRepository">
            {{ t("templates.repository") }}
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
          :key="`${entry.slug}@${entry.version}`"
          type="button"
          class="templates-view__row"
          @click="openDetails(entry)"
        >
          <span class="templates-view__row-main">
            <span class="templates-view__row-title">
              {{ localized(entry.title) }}
              <el-tag size="small" effect="plain" disable-transitions>v{{ entry.version }}</el-tag>
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
              :type="entry.target.scope === 'global' ? 'primary' : 'success'"
              disable-transitions
            >
              {{ t(`templates.scope.${entry.target.scope}`) }}
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
      width="min(720px, calc(100vw - 32px))"
      top="4vh"
      destroy-on-close
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
        <div class="template-detail__meta">
          <p>{{ localized(templates.selectedEntry.summary) }}</p>
          <dl>
            <div>
              <dt>{{ t("templates.detail.author") }}</dt>
              <dd>{{ templates.selectedEntry.author }}</dd>
            </div>
            <div>
              <dt>{{ t("templates.detail.target") }}</dt>
              <dd>{{ t(`templates.scope.${templates.selectedPackage.target.scope}`) }}</dd>
            </div>
            <template v-if="templates.selectedPackage.target.scope === 'app'">
              <div>
                <dt>{{ t("templates.detail.app") }}</dt>
                <dd>{{ templates.selectedPackage.target.name }}</dd>
              </div>
              <div v-if="templates.selectedPackage.target.windows">
                <dt>{{ t("templates.detail.windows") }}</dt>
                <dd>{{ templates.selectedPackage.target.windows.exeName }}</dd>
              </div>
              <div v-if="templates.selectedPackage.target.mac">
                <dt>{{ t("templates.detail.macos") }}</dt>
                <dd>{{ templates.selectedPackage.target.mac.bundleId }}</dd>
              </div>
            </template>
          </dl>
        </div>

        <el-alert
          v-if="hasElevatedRisk"
          type="warning"
          show-icon
          :closable="false"
          :title="t('templates.risk.warningTitle', { count: riskyIntents.length })"
        >
          <ul class="template-detail__risk-list">
            <li v-for="intent in riskyIntents" :key="intent.name">
              {{ intent.name }} - {{ t(`command.types.${intent.command.type}`) }}
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

        <div class="template-detail__section-head">
          <h3>{{ t("templates.detail.gestures", { count: packageIntents.length }) }}</h3>
        </div>
        <el-table :data="packageIntents" size="small" max-height="220">
          <el-table-column :label="t('gestures.colMnemonic')" width="105">
            <template #default="scope">
              <span class="template-detail__mnemonic">{{ gestureMnemonic(scope.row.gesture) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="t('gestures.colName')" min-width="145" />
          <el-table-column :label="t('gestures.colCommand')" min-width="140">
            <template #default="scope">{{ t(`command.types.${scope.row.command.type}`) }}</template>
          </el-table-column>
        </el-table>

        <div v-if="templates.adoptionPlan" class="template-detail__adoption">
          <div v-if="templates.adoptionPlan.conflicts.length" class="template-detail__conflicts">
            <h3>{{ t("templates.adoption.conflicts", { count: templates.adoptionPlan.conflicts.length }) }}</h3>
            <ul>
              <li v-for="conflict in templates.adoptionPlan.conflicts" :key="gestureMnemonic(conflict.gesture)">
                <strong>{{ gestureMnemonic(conflict.gesture) }}</strong>
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
        <el-button @click="detailVisible = false">{{ t("common.cancel") }}</el-button>
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
  background: transparent;
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
.template-detail__meta > p {
  margin: 0 0 12px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}
.template-detail__meta dl {
  margin: 0 0 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 20px;
}
.template-detail__meta dl > div {
  min-width: 0;
  display: grid;
  grid-template-columns: 78px minmax(0, 1fr);
  gap: 8px;
}
.template-detail__meta dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.template-detail__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
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
.template-detail__mnemonic {
  color: var(--el-color-primary);
  font-weight: 600;
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
  .template-detail__meta dl {
    grid-template-columns: 1fr;
  }
}
</style>
