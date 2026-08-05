import { computed, onScopeDispose, ref } from "vue";
import { defineStore } from "pinia";
import { useBackend, type LogEntry, type LogLevel, type LogsQueryRequest } from "../api/backend";
import { appLog } from "../logging";

export const useLogsStore = defineStore("logs", () => {
  const backend = useBackend();
  const level = ref<LogLevel>("off");
  const entries = ref<LogEntry[]>([]);
  const total = ref(0);
  const target = ref("");
  const keyword = ref("");
  const levelFilter = ref<LogLevel | "all">("all");
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastExportPath = ref<string | null>(null);
  const live = ref(true);
  let initialized = false;
  let requestPromise: Promise<void> | null = null;
  let unlisten: (() => void) | undefined;

  const hasEntries = computed(() => entries.value.length > 0);

  function newestFirst(next: LogEntry[]): LogEntry[] {
    return next
      .map((entry, index) => ({ entry, index, timestamp: Date.parse(entry.timestamp) }))
      .sort(
        (left, right) =>
          (Number.isNaN(right.timestamp) ? 0 : right.timestamp) -
            (Number.isNaN(left.timestamp) ? 0 : left.timestamp) ||
          left.index - right.index,
      )
      .map(({ entry }) => entry);
  }

  function request(): LogsQueryRequest {
    return {
      level: levelFilter.value === "all" ? null : levelFilter.value,
      target: target.value.trim() || null,
      keyword: keyword.value.trim() || null,
      limit: 2000,
    };
  }

  function matches(entry: LogEntry): boolean {
    if (levelFilter.value !== "all" && entry.level !== levelFilter.value) return false;
    const source = target.value.trim().toLocaleLowerCase();
    if (source && !entry.target.toLocaleLowerCase().includes(source)) return false;
    const text = keyword.value.trim().toLocaleLowerCase();
    return !text || `${entry.target} ${entry.message}`.toLocaleLowerCase().includes(text);
  }

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await backend.logsQuery(request());
      entries.value = newestFirst(result.entries).slice(0, 2000);
      total.value = result.total ?? result.entries.length;
      if (result.level) level.value = result.level;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      appLog.error("logs", "日志查询失败");
    } finally {
      loading.value = false;
    }
  }

  async function initialize(): Promise<void> {
    if (initialized) return;
    if (requestPromise) return requestPromise;
    requestPromise = (async () => {
      try {
        level.value = await backend.logLevelGet();
        unlisten = await backend.onLogEvent((entry) => {
          if (!matches(entry)) return;
          entries.value = [entry, ...entries.value].slice(0, 2000);
          total.value += 1;
        });
        await refresh();
        initialized = true;
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        appLog.error("logs", "日志中心初始化失败");
      } finally {
        requestPromise = null;
      }
    })();
    return requestPromise;
  }

  async function setLevel(next: LogLevel): Promise<void> {
    try {
      level.value = await backend.logLevelSet(next);
      appLog.info("logs", `日志级别已设置为 ${next}`);
      await refresh();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      appLog.error("logs", "日志级别设置失败");
    }
  }

  async function exportLogs(): Promise<string | null> {
    try {
      lastExportPath.value = await backend.logsExport(request());
      appLog.info("logs", "日志已导出");
      return lastExportPath.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      appLog.error("logs", "日志导出失败");
      return null;
    }
  }

  async function clear(): Promise<void> {
    try {
      await backend.logsClear();
      entries.value = [];
      total.value = 0;
      lastExportPath.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      appLog.error("logs", "日志清理失败");
    }
  }

  function resetFilters(): void {
    target.value = "";
    keyword.value = "";
    levelFilter.value = "all";
  }

  function toggleLive(): void {
    live.value = !live.value;
  }

  onScopeDispose(() => unlisten?.());
  return {
    level, entries, total, target, keyword, levelFilter, loading, error,
    hasEntries, live, lastExportPath, initialize, refresh, setLevel,
    exportLogs, clear, resetFilters, toggleLive,
  };
});
