<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  CaretBottom,
  CaretRight,
  Delete,
  Download,
  Setting,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useLogsStore } from "../stores/logs";
import type { LogLevel } from "../api/backend";

const { t, locale } = useI18n();
const logs = useLogsStore();
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

function toggleTrace(key: string) {
  const next = new Set(expandedTraces.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedTraces.value = next;
}

async function scrollToLatest() {
  await nextTick();
  if (logs.live && viewer.value) viewer.value.scrollTop = 0;
}

watch(
  () => (logs.entries[0] ? entryKey(logs.entries[0]) : ""),
  (current, previous) => {
    if (current !== previous) void scrollToLatest();
  },
);

function applyFilters() { void logs.refresh(); }
async function onLevelChange(value: LogLevel) { await logs.setLevel(value); }
async function onExport() {
  const path = await logs.exportLogs();
  if (path) ElMessage.success(t("logs.exported", { path }));
}
async function onClear() {
  try {
    await ElMessageBox.confirm(t("logs.clearConfirm"), t("logs.clearTitle"), {
      type: "warning", confirmButtonText: t("common.clear"), cancelButtonText: t("common.cancel"),
    });
    await logs.clear();
    ElMessage.success(t("logs.cleared"));
  } catch { /* cancelled */ }
}
onMounted(() => void logs.initialize());
</script>

<template>
  <div class="gg-page logs-page">
    <header class="gg-page__header logs-page__header">
      <div><h2>{{ t("logs.title") }}</h2><p class="gg-hint">{{ t("logs.subtitle") }}</p></div>
      <div class="logs-page__actions">
        <el-tooltip :content="t('logs.export')"><el-button circle :icon="Download" :disabled="!logs.hasEntries" :aria-label="t('logs.export')" @click="onExport" /></el-tooltip>
        <el-tooltip :content="t('logs.clear')"><el-button circle type="danger" plain :icon="Delete" :disabled="!logs.hasEntries" :aria-label="t('logs.clear')" @click="onClear" /></el-tooltip>
      </div>
    </header>

    <section class="logs-panel">
      <div class="logs-toolbar">
        <div class="logs-toolbar__level"><el-icon><Setting /></el-icon><span>{{ t("logs.collectionLevel") }}</span>
          <el-select :model-value="logs.level" size="small" @update:model-value="onLevelChange">
            <el-option v-for="value in ['off', 'error', 'warn', 'info', 'debug']" :key="value" :value="value" :label="t(`logs.levels.${value}`)" />
          </el-select>
        </div>
        <el-select v-model="logs.levelFilter" size="small" class="logs-toolbar__filter" :aria-label="t('logs.filterLevel')" @change="applyFilters">
          <el-option value="all" :label="t('logs.allLevels')" />
          <el-option v-for="value in ['error', 'warn', 'info', 'debug']" :key="value" :value="value" :label="t(`logs.levels.${value}`)" />
        </el-select>
        <el-input v-model="logs.target" size="small" clearable :placeholder="t('logs.sourcePlaceholder')" @keyup.enter="applyFilters" @clear="applyFilters" />
        <el-input v-model="logs.keyword" size="small" clearable :placeholder="t('logs.keywordPlaceholder')" @keyup.enter="applyFilters" @clear="applyFilters" />
        <el-button size="small" @click="logs.resetFilters(); applyFilters()">{{ t("logs.reset") }}</el-button>
      </div>
      <el-alert v-if="logs.error" type="error" show-icon :closable="false" :title="logs.error" />
      <div class="logs-meta">
        <span>{{ t("logs.count", { count: logs.total }) }}</span>
        <span class="logs-meta__level" :class="`is-${logs.level}`"><i />{{ t("logs.currentLevel", { level: t(`logs.levels.${logs.level}`) }) }}</span>
        <el-tooltip :content="t(logs.live ? 'logs.disableAutoFollow' : 'logs.enableAutoFollow')" placement="top">
          <span
            class="logs-meta__live"
            :class="{ 'is-off': !logs.live }"
            role="button"
            tabindex="0"
            :aria-pressed="logs.live"
            :aria-label="t(logs.live ? 'logs.disableAutoFollow' : 'logs.enableAutoFollow')"
            @click="logs.toggleLive"
            @keydown.enter.prevent="logs.toggleLive"
            @keydown.space.prevent="logs.toggleLive"
          ><i />{{ t("logs.autoFollow") }}</span>
        </el-tooltip>
      </div>
      <div v-if="logs.hasEntries" ref="viewer" class="logs-viewer" role="log" :aria-label="t('logs.title')" aria-live="polite">
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
            <el-icon>
              <CaretBottom v-if="entry.expanded" />
              <CaretRight v-else />
            </el-icon>
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
      <el-empty v-else :image-size="54" :description="logs.level === 'off' ? t('logs.offEmpty') : t('logs.empty')" />
      <p v-if="logs.lastExportPath" class="logs-export-path">{{ t("logs.exportPath", { path: logs.lastExportPath }) }}</p>
    </section>
  </div>
</template>

<style scoped>
.logs-page__header > div:first-child { min-width: 0; }
.logs-page__header p { margin: 4px 0 0; }
.logs-page__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.logs-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; gap: 10px; min-width: 0; min-height: 0; overflow: hidden; }
.logs-toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; padding: 9px 10px; border: 1px solid var(--gg-border); border-radius: 5px; background: var(--gg-surface); }
.logs-toolbar__level { display: inline-flex; align-items: center; gap: 6px; color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; }
.logs-toolbar__level .el-icon { color: var(--el-color-primary); }
.logs-toolbar .el-select { width: 116px; }
.logs-toolbar__filter { margin-left: auto; }
.logs-toolbar > .el-input { width: 180px; }
.logs-meta { display: flex; align-items: center; gap: 14px; min-height: 18px; color: var(--el-text-color-secondary); font-size: 11px; }
.logs-meta__level, .logs-meta__live { display: inline-flex; align-items: center; gap: 6px; }
.logs-meta__level i, .logs-meta__live i { width: 7px; height: 7px; border-radius: 50%; background: var(--el-color-info); }
.logs-meta__level.is-debug i { background: var(--el-color-primary); }.logs-meta__level.is-info i { background: var(--el-color-success); }.logs-meta__level.is-warn i { background: var(--el-color-warning); }.logs-meta__level.is-error i { background: var(--el-color-danger); }
.logs-meta__live { margin-left: auto; color: var(--el-color-success); cursor: pointer; user-select: none; }
.logs-meta__live i { background: var(--el-color-success); box-shadow: 0 0 0 3px var(--el-color-success-light-8); }
.logs-meta__live.is-off { color: var(--el-text-color-placeholder); }
.logs-meta__live.is-off i { background: var(--el-text-color-placeholder); box-shadow: none; }
.logs-meta__live:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; border-radius: 2px; }
.logs-viewer { min-width: 0; min-height: 0; overflow: auto; padding: 8px 12px; border: 1px solid var(--gg-border); border-radius: 5px; background: var(--gg-panel-muted); color: var(--el-text-color-regular); font: 11px/1.65 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
.log-line { display: grid; grid-template-columns: 28px 76px 42px minmax(92px, 155px) minmax(0, 1fr); gap: 9px; min-width: 668px; padding: 7px 0; border-bottom: 1px solid var(--gg-border); }
.log-line:last-child { border-bottom: 0; }
.log-line__toggle { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 3px; color: var(--el-text-color-placeholder); background: transparent; cursor: pointer; }
.log-line__toggle:hover, .log-line__toggle:focus-visible { color: var(--el-text-color-primary); background: var(--gg-title-control-hover); outline: none; }
.log-line__toggle .el-icon { font-size: 18px; }
.log-line__caret-spacer { display: block; width: 24px; height: 24px; }
.log-line__time { color: var(--el-text-color-placeholder); }
.log-line__level { font-weight: 700; color: var(--el-text-color-secondary); }
.log-line__target { overflow: hidden; text-overflow: ellipsis; color: var(--el-color-primary); }
.log-line__body { min-width: 0; }
.log-line__message { display: block; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.log-line__trace { display: block; margin-top: 5px; padding: 5px 0 2px 10px; border-left: 2px solid var(--gg-border); color: var(--el-text-color-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.log-line.is-error .log-line__level, .log-line.is-error .log-line__message { color: var(--el-color-danger); }
.log-line.is-warn .log-line__level { color: var(--el-color-warning); }
.log-line.is-info .log-line__level { color: var(--el-color-success); }
.log-line.is-debug .log-line__level { color: var(--el-color-primary); }
.logs-export-path { margin: 0; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-size: 11px; }
@media (max-width: 760px) { .logs-toolbar__filter { margin-left: 0; }.logs-toolbar > .el-input { flex: 1 1 160px; width: auto; }.log-line { grid-template-columns: 28px 68px 42px minmax(86px, 130px) minmax(0, 1fr); gap: 7px; min-width: 614px; } }
</style>
