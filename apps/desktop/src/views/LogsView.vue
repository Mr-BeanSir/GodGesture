<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Settings,
  Trash2,
} from "lucide-vue-next";
import {
  AppAlert,
  AppButton,
  AppEmptyState,
  AppSkeleton,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import { useLogsStore } from "../stores/logs";
import type { LogLevel } from "../api/backend";

const { t, locale } = useI18n();
const logs = useLogsStore();
const { confirm } = useConfirmDialog();
const viewer = ref<HTMLElement | null>(null);
const expandedTraces = ref(new Set<string>());

function entryKey(entry: { timestamp: string; target: string; message: string }): string {
  return `${entry.timestamp}\u0000${entry.target}\u0000${entry.message}`;
}

function traceLines(entry: { level: string; message: string }): string[] {
  if (entry.level !== "error" && entry.level !== "warn") return [];
  const lines = entry.message.replace(/\r\n?/g, "\n").split("\n");
  return lines.length > 1 ? lines.slice(1) : [];
}

const displayEntries = computed(() => logs.entries.map((entry) => {
  const details = traceLines(entry);
  return {
    ...entry,
    key: entryKey(entry),
    summary: entry.message.replace(/\r\n?/g, "\n").split("\n")[0] ?? "",
    details,
    hasTrace: details.length > 0,
    expanded: expandedTraces.value.has(entryKey(entry)),
    time: new Intl.DateTimeFormat(locale.value, {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      second: "2-digit", hour12: false,
    }).format(new Date(entry.timestamp)),
  };
}));

function toggleTrace(key: string): void {
  const next = new Set(expandedTraces.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedTraces.value = next;
}

async function scrollToLatest(): Promise<void> {
  await nextTick();
  if (logs.live && viewer.value) viewer.value.scrollTop = 0;
}

watch(
  () => (logs.entries[0] ? entryKey(logs.entries[0]) : ""),
  (current, previous) => {
    if (current !== previous) void scrollToLatest();
  },
);

function applyFilters(): void {
  void logs.refresh();
}

function onCollectionLevelChange(event: Event): void {
  void logs.setLevel((event.target as HTMLSelectElement).value as LogLevel);
}

function resetFilters(): void {
  logs.resetFilters();
  applyFilters();
}

async function onExport(): Promise<void> {
  const path = await logs.exportLogs();
  if (path) pushToast({ kind: "success", message: t("logs.exported", { path }) });
}

function onClear(): void {
  void confirm({
    title: t("logs.clearTitle"),
    message: t("logs.clearConfirm"),
    confirmLabel: t("common.clear"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
    onConfirm: async () => {
      if (!await logs.clear()) {
        pushToast({ kind: "error", message: logs.error ?? t("logs.clearFailed") });
        return false;
      }
      pushToast({ kind: "success", message: t("logs.cleared") });
      return true;
    },
  });
}

onMounted(() => void logs.initialize());
</script>

<template>
  <div class="gg-page logs-page">
    <header class="gg-page__header logs-page__header">
      <div>
        <h2>{{ t("logs.title") }}</h2>
        <p class="gg-hint">{{ t("logs.subtitle") }}</p>
      </div>
      <div class="logs-page__actions">
        <button
          type="button"
          class="gg-icon-button"
          :disabled="!logs.hasEntries"
          :aria-label="t('logs.export')"
          :title="t('logs.export')"
          @click="onExport"
        >
          <Download :size="18" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="gg-icon-button logs-page__clear"
          :disabled="!logs.hasEntries"
          :aria-label="t('logs.clear')"
          :title="t('logs.clear')"
          @click="onClear"
        >
          <Trash2 :size="18" aria-hidden="true" />
        </button>
      </div>
    </header>

    <section class="logs-panel">
      <div class="logs-toolbar">
        <label class="logs-toolbar__level">
          <Settings :size="16" aria-hidden="true" />
          <span>{{ t("logs.collectionLevel") }}</span>
          <select class="gg-select logs-toolbar__select" :value="logs.level" @change="onCollectionLevelChange">
            <option v-for="value in ['off', 'error', 'warn', 'info', 'debug']" :key="value" :value="value">
              {{ t(`logs.levels.${value}`) }}
            </option>
          </select>
        </label>
        <select
          v-model="logs.levelFilter"
          class="gg-select logs-toolbar__select logs-toolbar__filter"
          :aria-label="t('logs.filterLevel')"
          @change="applyFilters"
        >
          <option value="all">{{ t("logs.allLevels") }}</option>
          <option v-for="value in ['error', 'warn', 'info', 'debug']" :key="value" :value="value">
            {{ t(`logs.levels.${value}`) }}
          </option>
        </select>
        <input
          v-model="logs.target"
          class="gg-input logs-toolbar__input"
          type="search"
          :placeholder="t('logs.sourcePlaceholder')"
          @keydown.enter.prevent="applyFilters"
          @search="applyFilters"
        />
        <input
          v-model="logs.keyword"
          class="gg-input logs-toolbar__input"
          type="search"
          :placeholder="t('logs.keywordPlaceholder')"
          @keydown.enter.prevent="applyFilters"
          @search="applyFilters"
        />
        <AppButton size="sm" @click="resetFilters">{{ t("logs.reset") }}</AppButton>
      </div>

      <AppAlert v-if="logs.error" variant="error" :title="logs.error" />

      <div class="logs-meta">
        <span>{{ t("logs.count", { count: logs.total }) }}</span>
        <span class="logs-meta__level" :class="`is-${logs.level}`">
          <i aria-hidden="true" />
          {{ t("logs.currentLevel", { level: t(`logs.levels.${logs.level}`) }) }}
        </span>
        <button
          type="button"
          class="logs-meta__live"
          :class="{ 'is-off': !logs.live }"
          :aria-pressed="logs.live"
          :aria-label="t(logs.live ? 'logs.disableAutoFollow' : 'logs.enableAutoFollow')"
          :title="t(logs.live ? 'logs.disableAutoFollow' : 'logs.enableAutoFollow')"
          @click="logs.toggleLive"
        >
          <i aria-hidden="true" />
          {{ t("logs.autoFollow") }}
        </button>
      </div>

      <div v-if="logs.loading && !logs.hasEntries" class="logs-loading" role="status" aria-live="polite">
        <span class="gg-sr-only">{{ t("logs.loading") }}</span>
        <AppSkeleton :rows="5" />
      </div>
      <div v-else-if="logs.hasEntries" ref="viewer" class="logs-viewer" role="log" :aria-label="t('logs.title')" aria-live="polite">
        <div
          v-for="entry in displayEntries"
          :key="entry.key"
          class="log-line"
          :class="[`is-${entry.level}`, { 'has-trace': entry.hasTrace, 'is-expanded': entry.expanded }]"
        >
          <button
            v-if="entry.hasTrace"
            type="button"
            class="log-line__toggle"
            :aria-label="t(entry.expanded ? 'logs.collapseTrace' : 'logs.expandTrace')"
            :aria-expanded="entry.expanded"
            @click.stop="toggleTrace(entry.key)"
          >
            <ChevronDown v-if="entry.expanded" :size="18" aria-hidden="true" />
            <ChevronRight v-else :size="18" aria-hidden="true" />
          </button>
          <span v-else class="log-line__caret-spacer" aria-hidden="true" />
          <time class="log-line__time">{{ entry.time }}</time>
          <span class="log-line__level">{{ entry.level.toUpperCase() }}</span>
          <span class="log-line__target">{{ entry.target }}</span>
          <span class="log-line__body">
            <span class="log-line__message">{{ entry.summary }}</span>
            <span v-if="entry.expanded" class="log-line__trace">{{ entry.details.join("\n") }}</span>
          </span>
        </div>
      </div>
      <AppEmptyState
        v-else
        :title="logs.level === 'off' ? t('logs.offEmpty') : t('logs.empty')"
      />

      <p v-if="logs.lastExportPath" class="logs-export-path">{{ t("logs.exportPath", { path: logs.lastExportPath }) }}</p>
    </section>
  </div>
</template>

<style scoped>
.logs-page__header > div:first-child { min-width: 0; }
.logs-page__header p { margin: 4px 0 0; }
.logs-page__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.logs-page__clear { color: var(--gg-danger); }
.logs-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; gap: 10px; min-width: 0; min-height: 0; overflow: hidden; }
.logs-toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; padding: 9px 10px; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface); }
.logs-toolbar__level { display: inline-flex; align-items: center; gap: 6px; color: var(--gg-text-muted); font-size: 12px; white-space: nowrap; }
.logs-toolbar__level svg { color: var(--gg-primary); }
.logs-toolbar__select { width: 116px; min-height: 40px; }
.logs-toolbar__filter { margin-left: auto; }
.logs-toolbar__input { width: 180px; min-height: 40px; }
.logs-meta { display: flex; align-items: center; gap: 14px; min-height: 24px; color: var(--gg-text-muted); font-size: 12px; }
.logs-meta__level, .logs-meta__live { display: inline-flex; align-items: center; gap: 6px; }
.logs-meta__level i, .logs-meta__live i { width: 7px; height: 7px; border-radius: 50%; background: var(--gg-text-subtle); }
.logs-meta__level.is-debug i { background: var(--gg-primary); }.logs-meta__level.is-info i { background: var(--gg-success); }.logs-meta__level.is-warn i { background: var(--gg-warning); }.logs-meta__level.is-error i { background: var(--gg-danger); }
.logs-meta__live { margin-left: auto; min-height: 32px; border: 0; border-radius: 4px; padding: 0 6px; color: var(--gg-success); background: transparent; font: inherit; }
.logs-meta__live:hover { background: var(--gg-success-soft); }
.logs-meta__live i { background: var(--gg-success); box-shadow: 0 0 0 3px var(--gg-success-soft); }
.logs-meta__live.is-off { color: var(--gg-text-subtle); }.logs-meta__live.is-off i { background: var(--gg-text-subtle); box-shadow: none; }
.logs-loading { min-width: 0; padding: 12px; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface); }
.logs-viewer { min-width: 0; min-height: 0; overflow: auto; padding: 8px 12px; border: 1px solid var(--gg-border); border-radius: 6px; background: var(--gg-surface-muted); color: var(--gg-text); font: 11px/1.65 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
.log-line { display: grid; grid-template-columns: 28px 76px 42px minmax(92px, 155px) minmax(0, 1fr); gap: 9px; min-width: 668px; padding: 7px 0; border-bottom: 1px solid var(--gg-border); }
.log-line:last-child { border-bottom: 0; }
.log-line__toggle { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: var(--gg-text-subtle); background: transparent; }
.log-line__toggle:hover, .log-line__toggle:focus-visible { color: var(--gg-text); background: var(--gg-surface-hover); }
.log-line__caret-spacer { display: block; width: 24px; height: 24px; }
.log-line__time { color: var(--gg-text-subtle); }.log-line__level { color: var(--gg-text-muted); font-weight: 700; }.log-line__target { overflow: hidden; color: var(--gg-primary); text-overflow: ellipsis; }.log-line__body { min-width: 0; }.log-line__message { display: block; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }.log-line__trace { display: block; margin-top: 5px; border-left: 2px solid var(--gg-border); padding: 5px 0 2px 10px; color: var(--gg-text-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.log-line.is-error .log-line__level, .log-line.is-error .log-line__message { color: var(--gg-danger); }.log-line.is-warn .log-line__level { color: var(--gg-warning); }.log-line.is-info .log-line__level { color: var(--gg-success); }.log-line.is-debug .log-line__level { color: var(--gg-primary); }
.logs-export-path { margin: 0; overflow-wrap: anywhere; color: var(--gg-text-muted); font-size: 12px; }
</style>
