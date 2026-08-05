<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Download, Refresh, Setting } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useLogsStore } from "../stores/logs";
import type { LogLevel } from "../api/backend";

const { t, locale } = useI18n();
const logs = useLogsStore();
const displayEntries = computed(() => logs.entries.map((entry) => ({
  ...entry,
  time: new Intl.DateTimeFormat(locale.value, {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hour12: false,
  }).format(new Date(entry.timestamp)),
})));

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
        <el-tooltip :content="t('logs.refresh')"><el-button circle :icon="Refresh" :loading="logs.loading" :aria-label="t('logs.refresh')" @click="applyFilters" /></el-tooltip>
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
        <span v-if="logs.live" class="logs-meta__live"><i />{{ t("logs.live") }}</span>
      </div>
      <div v-if="logs.hasEntries" class="logs-viewer" role="log" :aria-label="t('logs.title')" aria-live="polite">
        <div v-for="entry in displayEntries" :key="`${entry.timestamp}-${entry.target}-${entry.message}`" class="log-line" :class="`is-${entry.level}`">
          <time class="log-line__time">{{ entry.time }}</time><span class="log-line__level">{{ entry.level.toUpperCase() }}</span><span class="log-line__target">{{ entry.target }}</span><span class="log-line__message">{{ entry.message }}</span>
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
.logs-meta__live { color: var(--el-color-success); }.logs-meta__live i { background: var(--el-color-success); box-shadow: 0 0 0 3px var(--el-color-success-light-8); }
.logs-viewer { min-width: 0; min-height: 0; overflow: auto; padding: 10px 12px; border: 1px solid #30353b; border-radius: 5px; background: #15181b; color: #d6dbe0; font: 11px/1.65 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; }
.log-line { display: grid; grid-template-columns: 76px 42px minmax(92px, 155px) minmax(0, 1fr); gap: 9px; min-width: 640px; padding: 2px 0; }.log-line__time { color: #7d8791; }.log-line__level { font-weight: 700; color: #8e9aa5; }.log-line__target { overflow: hidden; text-overflow: ellipsis; color: #9cc5e8; }.log-line__message { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.log-line.is-error .log-line__level, .log-line.is-error .log-line__message { color: #ff8989; }.log-line.is-warn .log-line__level { color: #f5c66c; }.log-line.is-info .log-line__level { color: #9ad5ad; }.log-line.is-debug .log-line__level { color: #b6a8e6; }
.logs-export-path { margin: 0; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-size: 11px; }
@media (max-width: 760px) { .logs-toolbar__filter { margin-left: 0; }.logs-toolbar > .el-input { flex: 1 1 160px; width: auto; }.log-line { grid-template-columns: 68px 42px minmax(86px, 130px) minmax(0, 1fr); gap: 7px; } }
</style>
