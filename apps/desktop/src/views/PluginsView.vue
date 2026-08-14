<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  CircleCheck,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  TriangleAlert,
} from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppDialog,
  AppEmptyState,
  AppSkeleton,
  AppSpinner,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import { OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL } from "@godgesture/shared";
import { usePluginsStore } from "../stores/plugins";

const { t, locale } = useI18n();
const plugins = usePluginsStore();
const { confirm } = useConfirmDialog();

const selected = computed(() => plugins.selected);
const onlineEntries = computed(() => plugins.onlineEntries);
const onlineDialogVisible = ref(false);
const openingRoot = ref(false);
const openingProjectPath = ref<string | null>(null);
const openingRepositoryUrl = ref<string | null>(null);
const onlineDialogBusy = computed(() => Boolean(plugins.installingPluginId));

const lastReload = computed(() => {
  const timestamp = selected.value?.lastReloadAt;
  if (!timestamp) return t("plugins.neverReloaded");
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
});

onMounted(() => {
  void plugins.initialize();
  void plugins.loadOnlineCatalog();
});

function localized(value: string) {
  return value;
}

function onlineSource(entry: (typeof onlineEntries.value)[number]): string {
  return `${OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL}${entry.subdirectory ? `/${entry.subdirectory}` : ""}`;
}

function installOnline(entry: (typeof onlineEntries.value)[number]): void {
  void confirm({
    title: t("plugins.online.confirmTitle"),
    message: t("plugins.online.confirmBody", {
      name: localized(entry.title),
      source: onlineSource(entry),
    }),
    confirmLabel: t("plugins.online.install"),
    cancelLabel: t("common.cancel"),
    variant: "primary",
    onConfirm: async () => {
      const installed = await plugins.installOnline(entry);
      pushToast({
        kind: installed ? "success" : "error",
        message: t(installed ? "plugins.online.success" : "plugins.online.failed"),
      });
      return installed;
    },
  });
}

async function openRoot(): Promise<void> {
  if (openingRoot.value) return;
  openingRoot.value = true;
  try {
    await plugins.openRoot();
  } finally {
    openingRoot.value = false;
  }
}

async function openProject(path: string): Promise<void> {
  if (openingProjectPath.value) return;
  openingProjectPath.value = path;
  try {
    await plugins.openProject(path);
  } finally {
    openingProjectPath.value = null;
  }
}

async function refreshPlugins(): Promise<void> {
  if (plugins.loading) return;
  await plugins.refresh();
}

async function refreshOnlineCatalog(): Promise<void> {
  if (plugins.loadingOnlineCatalog) return;
  await plugins.loadOnlineCatalog(true);
}

async function openRepository(url: string): Promise<void> {
  if (openingRepositoryUrl.value) return;
  openingRepositoryUrl.value = url;
  try {
    await plugins.backend?.openExternal(url);
  } finally {
    openingRepositoryUrl.value = null;
  }
}

function openOnlinePlugins(): void {
  onlineDialogVisible.value = true;
}

function closeOnlinePlugins(): void {
  if (!onlineDialogBusy.value) onlineDialogVisible.value = false;
}
</script>

<template>
  <div class="gg-page plugins-page">
    <header class="gg-page__header plugins-page__header">
      <div>
        <h2>{{ t("plugins.title") }}</h2>
        <p class="gg-hint">{{ t("plugins.subtitle") }}</p>
      </div>
      <div class="plugins-page__actions">
        <AppButton
          class="plugins-page__text-action"
          :loading="openingRoot"
          :loading-label="t('plugins.openFolder')"
          :aria-label="t('plugins.openFolder')"
          :title="t('plugins.openFolder')"
          @click="openRoot"
        >
          <FolderOpen class="plugins-page__button-icon" aria-hidden="true" />
          <span class="plugins-page__button-label">{{ t("plugins.openFolder") }}</span>
        </AppButton>
        <AppButton
          data-testid="plugins-open-online-catalog"
          class="plugins-page__text-action"
          variant="primary"
          :aria-label="t('plugins.downloadPlugins')"
          :title="t('plugins.downloadPlugins')"
          @click="openOnlinePlugins"
        >
          <Download class="plugins-page__button-icon" aria-hidden="true" />
          <span class="plugins-page__button-label">{{ t("plugins.downloadPlugins") }}</span>
        </AppButton>
        <button
          type="button"
          class="gg-icon-button plugins-page__icon-action"
          :disabled="plugins.loading"
          :aria-busy="plugins.loading || undefined"
          :aria-label="t('plugins.rescan')"
          :title="t('plugins.rescan')"
          @click="refreshPlugins"
        >
          <AppSpinner v-if="plugins.loading" size="sm" aria-hidden="true" />
          <RefreshCw v-else :size="18" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="plugins-page__content">
      <AppAlert v-if="plugins.error" variant="error" :title="plugins.error.message" />

      <main class="plugins-workspace">
        <aside class="plugins-workspace__rail">
          <div class="plugins-workspace__rail-head">
            <span>{{ t("plugins.projects") }}</span>
            <span>{{ plugins.plugins.length }}</span>
          </div>
          <div class="plugins-workspace__list">
            <ul v-if="plugins.plugins.length > 0" class="plugin-list" :aria-label="t('plugins.projects')">
              <li v-for="plugin in plugins.plugins" :key="plugin.path">
                <button
                  type="button"
                  class="plugin-row"
                  :class="{ 'is-active': selected?.path === plugin.path }"
                  :aria-current="selected?.path === plugin.path ? 'true' : undefined"
                  @click="plugins.selectedPath = plugin.path"
                >
                  <span class="plugin-row__status" :class="`is-${plugin.status}`" aria-hidden="true" />
                  <span class="plugin-row__body">
                    <strong>{{ plugin.name }}</strong>
                    <span>
                      {{ plugin.status === "ready"
                        ? t("plugins.lifecycleCount", { count: plugin.lifecycles.length })
                        : t("plugins.invalid") }}
                    </span>
                    <span class="plugin-row__status-label">
                      {{ plugin.status === "ready" ? t("plugins.statusReady") : t("plugins.statusError") }}
                    </span>
                  </span>
                </button>
              </li>
            </ul>
            <AppEmptyState
              v-else-if="!plugins.loading"
              :title="t('plugins.empty')"
            >
              <AppButton
                size="sm"
                :loading="openingRoot"
                :loading-label="t('plugins.openFolder')"
                @click="openRoot"
              >
                <FolderOpen class="plugins-page__button-icon" aria-hidden="true" />
                {{ t("plugins.openFolder") }}
              </AppButton>
            </AppEmptyState>
            <div v-else class="plugins-workspace__loading" role="status" aria-live="polite">
              <span class="gg-sr-only">{{ t("plugins.rescan") }}</span>
              <AppSkeleton :rows="4" />
            </div>
          </div>
          <div class="plugins-workspace__root" :title="plugins.snapshot.root">
            <FolderOpen :size="14" aria-hidden="true" />
            <code>{{ plugins.snapshot.root }}</code>
          </div>
        </aside>

        <section v-if="selected" class="plugin-detail" :aria-label="selected.name">
          <header class="plugin-detail__header">
            <div class="plugin-detail__identity">
              <span
                class="plugin-detail__icon"
                :class="`is-${selected.status}`"
                :aria-label="selected.status === 'ready' ? t('plugins.statusReady') : t('plugins.statusError')"
                role="img"
              >
                <CircleCheck v-if="selected.status === 'ready'" :size="18" aria-hidden="true" />
                <TriangleAlert v-else :size="18" aria-hidden="true" />
              </span>
              <div class="plugin-detail__identity-copy">
                <h3>{{ selected.name }}</h3>
                <p>{{ selected.id }}</p>
              </div>
              <AppBadge :variant="selected.status === 'ready' ? 'success' : 'danger'">
                {{ selected.status === "ready" ? t("plugins.statusReady") : t("plugins.statusError") }}
              </AppBadge>
            </div>
            <AppButton
              class="plugin-detail__project-action"
              size="sm"
              :loading="openingProjectPath === selected.path"
              :loading-label="t('plugins.openProject')"
              :disabled="Boolean(openingProjectPath)"
              :aria-label="t('plugins.openProject')"
              :title="t('plugins.openProject')"
              @click="openProject(selected.path)"
            >
              <FolderOpen class="plugins-page__button-icon" aria-hidden="true" />
              <span class="plugin-detail__project-label">{{ t("plugins.openProject") }}</span>
            </AppButton>
          </header>

          <AppAlert
            v-if="selected.status === 'error'"
            class="plugin-detail__problem"
            variant="error"
            :title="t('plugins.problemTitle')"
          >
            <pre>{{ selected.error }}</pre>
          </AppAlert>

          <template v-else>
            <dl class="plugin-detail__facts">
              <div><dt>{{ t("plugins.version") }}</dt><dd>{{ selected.version || "-" }}</dd></div>
              <div><dt>{{ t("plugins.apiVersion") }}</dt><dd>{{ selected.apiVersion }}</dd></div>
              <div><dt>{{ t("plugins.entry") }}</dt><dd><code>{{ selected.entry }}</code></dd></div>
              <div>
                <dt>{{ t("plugins.lastReload") }}</dt>
                <dd><Clock :size="13" aria-hidden="true" />{{ lastReload }}</dd>
              </div>
            </dl>

            <section class="plugin-detail__section">
              <div class="plugin-detail__section-head">
                <h4>{{ t("plugins.lifecycles") }}</h4>
                <span class="plugin-detail__live">
                  <span class="plugin-detail__live-dot" aria-hidden="true" />
                  {{ t("plugins.hotReloadActive") }}
                </span>
              </div>
              <div class="plugin-actions">
                <div v-for="lifecycle in selected.lifecycles" :key="lifecycle" class="plugin-action">
                  <strong>{{ lifecycle }}</strong>
                  <code>{{ lifecycle }}</code>
                </div>
              </div>
            </section>
          </template>
        </section>

        <AppEmptyState
          v-else
          class="plugin-detail plugin-detail--empty"
          :title="t('plugins.emptyDetailTitle')"
          :description="t('plugins.emptyDetail')"
        >
          <AppButton
            size="sm"
            :loading="openingRoot"
            :loading-label="t('plugins.openFolder')"
            @click="openRoot"
          >
            <FolderOpen class="plugins-page__button-icon" aria-hidden="true" />
            {{ t("plugins.openFolder") }}
          </AppButton>
        </AppEmptyState>
      </main>

      <AppDialog
        class="plugins-online-dialog"
        :open="onlineDialogVisible"
        :title="t('plugins.downloadPlugins')"
        :close-label="t('common.close')"
        :busy="onlineDialogBusy"
        @close="closeOnlinePlugins"
      >
        <section class="plugins-online" :aria-label="t('plugins.online.title')">
          <header class="plugins-online__header">
            <div>
              <h3>{{ t("plugins.online.title") }}</h3>
              <p class="gg-hint">{{ t("plugins.online.subtitle") }}</p>
            </div>
            <button
              type="button"
              class="gg-icon-button"
              :disabled="plugins.loadingOnlineCatalog"
              :aria-busy="plugins.loadingOnlineCatalog || undefined"
              :aria-label="t('plugins.online.refresh')"
              :title="t('plugins.online.refresh')"
              @click="refreshOnlineCatalog"
            >
              <AppSpinner v-if="plugins.loadingOnlineCatalog" size="sm" aria-hidden="true" />
              <RefreshCw v-else :size="18" aria-hidden="true" />
            </button>
          </header>
          <AppAlert
            v-if="plugins.onlineCatalogError"
            variant="error"
            :title="t('plugins.online.loadFailed')"
          />
          <div v-else-if="plugins.loadingOnlineCatalog" class="plugins-online__loading" role="status" aria-live="polite">
            <span class="gg-sr-only">{{ t("plugins.online.refresh") }}</span>
            <AppSkeleton :rows="2" />
          </div>
          <AppEmptyState
            v-else-if="onlineEntries.length === 0"
            :title="t('plugins.online.empty')"
          />
          <div v-else class="plugins-online__list">
            <article v-for="entry in onlineEntries" :key="entry.pluginId" class="plugins-online__row">
              <div class="plugins-online__identity">
                <strong>{{ localized(entry.title) }}</strong>
                <span>{{ localized(entry.summary) }}</span>
                <code>{{ onlineSource(entry) }}</code>
              </div>
              <div class="plugins-online__actions">
                <AppBadge v-if="plugins.installedPluginIds.has(entry.pluginId)" variant="success">
                  {{ t("plugins.online.installed") }}
                </AppBadge>
                <AppButton
                  v-else
                  :data-testid="`plugins-install-${entry.pluginId}`"
                  variant="primary"
                  size="sm"
                  :loading="plugins.installingPluginId === entry.pluginId"
                  :loading-label="t('plugins.online.installing')"
                  :disabled="onlineDialogBusy"
                  :aria-label="t('plugins.online.install')"
                  :title="t('plugins.online.install')"
                  @click="installOnline(entry)"
                >
                  <Download class="plugins-page__button-icon" aria-hidden="true" />
                  {{ plugins.installingPluginId === entry.pluginId ? t("plugins.online.installing") : t("plugins.online.install") }}
                </AppButton>
                <button
                  type="button"
                  class="gg-icon-button"
                  :disabled="openingRepositoryUrl === OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL"
                  :aria-busy="openingRepositoryUrl === OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL || undefined"
                  :aria-label="t('plugins.online.repository')"
                  :title="t('plugins.online.repository')"
                  @click="openRepository(OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL)"
                >
                  <AppSpinner
                    v-if="openingRepositoryUrl === OFFICIAL_ONLINE_PLUGIN_REPOSITORY_URL"
                    size="sm"
                    aria-hidden="true"
                  />
                  <ExternalLink v-else :size="16" aria-hidden="true" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </AppDialog>
    </div>
  </div>
</template>

<style scoped>
.plugins-page__header > div:first-child {
  min-width: 0;
}

.plugins-page__header p {
  margin: 4px 0 0;
}

.plugins-page__actions {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 8px;
  flex: 0 0 auto;
}

.plugins-page__button-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.plugins-page__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
}

.plugins-workspace {
  display: grid;
  grid-template-columns: minmax(210px, 260px) minmax(0, 1fr);
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
}

.plugins-workspace__rail {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--gg-border);
  background: var(--gg-surface-muted);
}

.plugins-workspace__rail-head {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px 8px;
  color: var(--gg-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.plugins-workspace__list {
  min-height: 0;
  overflow-y: auto;
  padding: 0 7px 8px;
}

.plugin-list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plugin-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  width: 100%;
  min-height: 44px;
  gap: 9px;
  border: 0;
  border-radius: 5px;
  padding: 9px 10px;
  color: var(--gg-text);
  background: transparent;
  text-align: left;
}

.plugin-row:hover {
  background: var(--gg-surface-hover);
}

.plugin-row:focus-visible {
  outline: 2px solid var(--gg-ring);
  outline-offset: -2px;
}

.plugin-row.is-active {
  background: var(--gg-primary-soft);
  color: var(--gg-primary);
}

.plugin-row__status {
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--gg-danger);
}

.plugin-row__status.is-ready {
  background: var(--gg-success);
}

.plugin-row__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.plugin-row__body strong,
.plugin-row__body span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-row__body strong {
  font-size: 13px;
  font-weight: 600;
}

.plugin-row__body span {
  color: var(--gg-text-muted);
  font-size: 11px;
}

.plugin-row.is-active .plugin-row__body span {
  color: var(--gg-primary);
}

.plugin-row__status-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.plugins-workspace__loading,
.plugins-online__loading {
  padding: 12px;
}

.plugins-workspace__root {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  border-top: 1px solid var(--gg-border);
  padding: 9px 11px;
  color: var(--gg-text-muted);
}

.plugins-workspace__root code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.plugin-detail {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 20px;
}

.plugin-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.plugin-detail__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
}

.plugin-detail__identity-copy {
  min-width: 0;
}

.plugin-detail__identity h3 {
  margin: 0;
  font-size: 17px;
}

.plugin-detail__identity p {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  color: var(--gg-text-muted);
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.plugin-detail__icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: var(--gg-danger);
  background: var(--gg-danger-soft);
}

.plugin-detail__icon.is-ready {
  color: var(--gg-success);
  background: var(--gg-success-soft);
}

.plugin-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  margin: 18px 0 0;
  border-top: 1px solid var(--gg-border);
  border-left: 1px solid var(--gg-border);
}

.plugin-detail__facts > div {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 8px;
  border-right: 1px solid var(--gg-border);
  border-bottom: 1px solid var(--gg-border);
  padding: 10px;
}

.plugin-detail__facts dt {
  color: var(--gg-text-muted);
  font-size: 12px;
}

.plugin-detail__facts dd {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.plugin-detail__facts dd svg {
  flex: 0 0 auto;
  color: var(--gg-text-muted);
}

.plugin-detail__facts code,
.plugin-action code {
  font: 11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.plugin-detail__section {
  margin-top: 20px;
}

.plugin-detail__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.plugin-detail__section h4 {
  margin: 0;
  font-size: 13px;
}

.plugin-detail__live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--gg-text-muted);
  font-size: 11px;
}

.plugin-detail__live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--gg-success);
  box-shadow: 0 0 0 3px var(--gg-success-soft);
}

.plugin-actions {
  border-top: 1px solid var(--gg-border);
}

.plugin-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--gg-border);
  padding: 10px 2px;
}

.plugin-action strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.plugin-detail__problem {
  margin-top: 18px;
}

.plugin-detail__problem pre {
  margin: 7px 0 0;
  overflow-wrap: anywhere;
  color: var(--gg-text);
  font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
}

.plugin-detail--empty {
  align-content: center;
}

.plugins-online {
  min-width: 0;
}

.plugins-online__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.plugins-online__header h3 {
  margin: 0;
  font-size: 14px;
}

.plugins-online__header p {
  margin: 3px 0 0;
}

.plugins-online__list {
  border-top: 1px solid var(--gg-border);
}

.plugins-online__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--gg-border);
  padding: 11px 0;
}

.plugins-online__identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.plugins-online__identity strong {
  font-size: 13px;
}

.plugins-online__identity span,
.plugins-online__identity code {
  color: var(--gg-text-muted);
}

.plugins-online__identity span {
  font-size: 12px;
}

.plugins-online__identity code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.plugins-online__actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
}

:deep(.plugins-online-dialog) {
  width: min(760px, calc(100vw - 32px));
}

:deep(.plugins-online-dialog .gg-dialog__body) {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

</style>
