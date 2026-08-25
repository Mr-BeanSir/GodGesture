<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RefreshCw, Search } from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppEmptyState,
  AppSkeleton,
  AppSpinner,
} from "@godgesture/ui";
import type { GestureTemplateCatalogEntry } from "@godgesture/shared";
import { useTemplatesStore } from "../stores/templates";
import GestureTemplateAdoptionDialog from "../components/GestureTemplateAdoptionDialog.vue";

const { t } = useI18n();
const templates = useTemplatesStore();

onMounted(() => {
  void templates.loadCatalog();
});

function localized(value: string): string {
  return value;
}

function openDetails(entry: GestureTemplateCatalogEntry): void {
  void templates.openDetails(entry);
}

function errorText(code: string): string {
  const key = "templates.errors." + code;
  const translated = t(key);
  return translated === key ? t("templates.errors.unknown") : translated;
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
          <span v-if="entry.tags.length" class="templates-view__tags">
            <AppBadge v-for="tag in entry.tags" :key="tag" variant="info">{{ tag }}</AppBadge>
          </span>
        </span>
        <span class="templates-view__row-meta">
          <AppBadge :variant="entry.risks.length ? 'warning' : 'info'">
            {{ t(entry.risks.length ? "templates.risk.elevated" : "templates.risk.low") }}
          </AppBadge>
          <span>{{ entry.author }}</span>
        </span>
      </button>
    </section>

    <GestureTemplateAdoptionDialog
      :open="templates.selectedEntry !== null"
      :close-label="t('common.close')"
      @close="templates.closeDetails"
    />
  </div>
</template>

<style scoped>
.templates-view { width: min(100%, 920px); height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 14px; overflow: hidden; }
.templates-view__header > div { min-width: 0; }
.templates-view__header h2 { margin: 0; font-size: 16px; }
.templates-view__header p { margin: 5px 0 0; }
.templates-view__filters { display: grid; grid-template-columns: minmax(180px, 1fr) 150px; gap: 10px; align-items: center; }
.templates-view__search { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--gg-border); border-radius: 6px; padding: 0 10px; color: var(--gg-text-muted); background: var(--gg-surface); }
.templates-view__search:focus-within { outline: 2px solid var(--gg-ring); outline-offset: 1px; }
.templates-view__search .gg-input { min-width: 0; border: 0; box-shadow: none; }
.templates-view__list { display: grid; grid-auto-rows: max-content; align-content: start; min-width: 0; min-height: 0; gap: 8px; overflow-y: auto; padding: 1px 2px 4px; scrollbar-gutter: stable; }
.templates-view__row { width: 100%; min-height: 79px; display: grid; grid-template-columns: minmax(0, 1fr) 128px; gap: 18px; padding: 14px 16px; border: 1px solid var(--gg-border); border-radius: 8px; color: var(--gg-text); background: var(--gg-surface); text-align: left; cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease; }
.templates-view__row:hover { border-color: var(--gg-primary-border); background: var(--gg-surface-hover); }
.templates-view__row:focus-visible { outline: 2px solid var(--gg-ring); outline-offset: -2px; }
.templates-view__row-main, .templates-view__row-meta, .templates-view__tags { display: flex; }
.templates-view__row-main { min-width: 0; flex-direction: column; gap: 7px; }
.templates-view__row-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 14px; font-weight: 600; }
.templates-view__summary { color: var(--gg-text-muted); font-size: 13px; line-height: 1.45; }
.templates-view__tags { flex-wrap: wrap; gap: 5px; }
.templates-view__row-meta { width: 128px; flex-direction: column; align-items: flex-end; gap: 7px; color: var(--gg-text-muted); font-size: 12px; }
</style>
