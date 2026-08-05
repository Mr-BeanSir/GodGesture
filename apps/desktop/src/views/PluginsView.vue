<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  CircleCheck,
  Clock,
  FolderOpened,
  Refresh,
  Warning,
} from "@element-plus/icons-vue";
import { usePluginsStore } from "../stores/plugins";

const { t, locale } = useI18n();
const plugins = usePluginsStore();

const selected = computed(() => plugins.selected);

const lastReload = computed(() => {
  const timestamp = selected.value?.lastReloadAt;
  if (!timestamp) return t("plugins.neverReloaded");
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
});

onMounted(() => void plugins.initialize());
</script>

<template>
  <div class="gg-page plugins-page">
    <header class="gg-page__header plugins-page__header">
      <div>
        <h2>{{ t("plugins.title") }}</h2>
        <p class="gg-hint">{{ t("plugins.subtitle") }}</p>
      </div>
      <div class="plugins-page__actions">
        <el-button :icon="FolderOpened" @click="plugins.openRoot()">
          {{ t("plugins.openFolder") }}
        </el-button>
        <el-tooltip :content="t('plugins.rescan')">
          <el-button
            :icon="Refresh"
            circle
            :loading="plugins.loading"
            :aria-label="t('plugins.rescan')"
            @click="plugins.refresh()"
          />
        </el-tooltip>
      </div>
    </header>

    <div class="plugins-page__content">
      <el-alert
        v-if="plugins.error"
        type="error"
        show-icon
        :closable="false"
        :title="plugins.error.message"
      />

    <main class="plugins-workspace">
      <aside class="plugins-workspace__rail">
        <div class="plugins-workspace__rail-head">
          <span>{{ t("plugins.projects") }}</span>
          <span>{{ plugins.plugins.length }}</span>
        </div>
        <div class="plugins-workspace__list" role="list" :aria-label="t('plugins.projects')">
          <button
            v-for="plugin in plugins.plugins"
            :key="plugin.path"
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
                  ? t("plugins.actionCount", { count: plugin.actions.length })
                  : t("plugins.invalid") }}
              </span>
              <span class="plugin-row__status-label">
                {{ plugin.status === "ready" ? t("plugins.statusReady") : t("plugins.statusError") }}
              </span>
            </span>
          </button>
          <el-empty
            v-if="!plugins.loading && plugins.plugins.length === 0"
            :image-size="48"
            :description="t('plugins.empty')"
          >
            <el-button size="small" :icon="FolderOpened" @click="plugins.openRoot()">
              {{ t("plugins.openFolder") }}
            </el-button>
          </el-empty>
          <el-skeleton v-if="plugins.loading && plugins.plugins.length === 0" :rows="4" animated />
        </div>
        <div class="plugins-workspace__root" :title="plugins.snapshot.root">
          <FolderOpened />
          <code>{{ plugins.snapshot.root }}</code>
        </div>
      </aside>

      <section v-if="selected" class="plugin-detail">
        <header class="plugin-detail__header">
          <div class="plugin-detail__identity">
            <span
              class="plugin-detail__icon"
              :class="`is-${selected.status}`"
              :aria-label="selected.status === 'ready' ? t('plugins.statusReady') : t('plugins.statusError')"
              role="img"
            >
              <CircleCheck v-if="selected.status === 'ready'" />
              <Warning v-else />
            </span>
            <div>
              <h3>{{ selected.name }}</h3>
              <p>{{ selected.id }}</p>
            </div>
          </div>
          <el-button :icon="FolderOpened" @click="plugins.openProject(selected.path)">
            {{ t("plugins.openProject") }}
          </el-button>
        </header>

        <div v-if="selected.status === 'error'" class="plugin-detail__problem">
          <Warning />
          <div>
            <strong>{{ t("plugins.problemTitle") }}</strong>
            <pre>{{ selected.error }}</pre>
          </div>
        </div>

        <template v-else>
          <dl class="plugin-detail__facts">
            <div><dt>{{ t("plugins.version") }}</dt><dd>{{ selected.version || "-" }}</dd></div>
            <div><dt>{{ t("plugins.apiVersion") }}</dt><dd>{{ selected.apiVersion }}</dd></div>
            <div><dt>{{ t("plugins.entry") }}</dt><dd><code>{{ selected.entry }}</code></dd></div>
            <div><dt>{{ t("plugins.lastReload") }}</dt><dd><Clock />{{ lastReload }}</dd></div>
          </dl>

          <section class="plugin-detail__section">
            <div class="plugin-detail__section-head">
              <h4>{{ t("plugins.actions") }}</h4>
              <span class="plugin-detail__live"><i />{{ t("plugins.hotReloadActive") }}</span>
            </div>
            <div class="plugin-actions">
              <div v-for="action in selected.actions" :key="action.id" class="plugin-action">
                <div>
                  <strong>{{ action.name }}</strong>
                  <span>{{ action.id }}</span>
                </div>
                <code>{{ action.exportName }}</code>
              </div>
            </div>
          </section>
        </template>
      </section>

          <div v-else class="plugin-detail plugin-detail--empty">
            <FolderOpened class="plugin-detail__empty-icon" />
            <strong>{{ t('plugins.emptyDetailTitle') }}</strong>
            <p>{{ t('plugins.emptyDetail') }}</p>
            <el-button size="small" :icon="FolderOpened" @click="plugins.openRoot()">
              {{ t('plugins.openFolder') }}
            </el-button>
          </div>
    </main>
    </div>
  </div>
</template>

<style scoped>
.plugins-page__header > div:first-child { min-width: 0; }
.plugins-page__header p { margin: 4px 0 0; }
.plugins-page__actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.plugins-page__content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
}
.plugins-page__content > .plugins-workspace:first-child { grid-row: 1 / -1; }
.plugins-workspace {
  display: grid;
  grid-template-columns: minmax(210px, 260px) minmax(0, 1fr);
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
  background: var(--gg-sidebar);
}
.plugins-workspace__rail-head {
  display: flex;
  justify-content: space-between;
  padding: 10px 12px 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}
.plugins-workspace__list { min-height: 0; overflow-y: auto; padding: 0 7px 8px; }
.plugin-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.plugin-row:hover { background: var(--gg-title-control-hover); }
.plugin-row:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.plugin-row.is-active { background: var(--el-color-primary-light-9); color: var(--el-color-primary-dark-2); }
.plugin-row__status { width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--el-color-danger); }
.plugin-row__status.is-ready { background: var(--el-color-success); }
.plugin-row__body { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.plugin-row__body strong,
.plugin-row__body span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-row__body strong { font-size: 13px; font-weight: 600; }
.plugin-row__body span { color: var(--el-text-color-secondary); font-size: 11px; }
.plugin-row__status-label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.plugins-workspace__root {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 9px 11px;
  border-top: 1px solid var(--gg-border);
  color: var(--el-text-color-secondary);
}
.plugins-workspace__root svg { width: 14px; flex: 0 0 auto; }
.plugins-workspace__root code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.plugin-detail { min-width: 0; min-height: 0; overflow-y: auto; padding: 18px 20px; }
.plugin-detail__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.plugin-detail__identity { display: flex; min-width: 0; align-items: center; gap: 11px; }
.plugin-detail__identity h3 { margin: 0; font-size: 17px; }
.plugin-detail__identity p { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--el-text-color-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.plugin-detail__icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 6px; color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.plugin-detail__icon.is-ready { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.plugin-detail__icon svg { width: 17px; }
.plugin-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  margin: 18px 0 0;
  border-top: 1px solid var(--gg-border);
  border-left: 1px solid var(--gg-border);
}
.plugin-detail__facts > div { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 8px; padding: 10px; border-right: 1px solid var(--gg-border); border-bottom: 1px solid var(--gg-border); }
.plugin-detail__facts dt { color: var(--el-text-color-secondary); font-size: 12px; }
.plugin-detail__facts dd { display: flex; min-width: 0; align-items: center; gap: 5px; margin: 0; overflow-wrap: anywhere; font-size: 12px; }
.plugin-detail__facts dd svg { width: 13px; color: var(--el-text-color-secondary); }
.plugin-detail__facts code,
.plugin-action code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }
.plugin-detail__section { margin-top: 20px; }
.plugin-detail__section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.plugin-detail__section h4 { margin: 0; font-size: 13px; }
.plugin-detail__live { display: inline-flex; align-items: center; gap: 6px; color: var(--el-text-color-secondary); font-size: 11px; }
.plugin-detail__live i { width: 7px; height: 7px; border-radius: 50%; background: var(--el-color-success); box-shadow: 0 0 0 3px var(--el-color-success-light-8); }
.plugin-actions { border-top: 1px solid var(--gg-border); }
.plugin-action { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 2px; border-bottom: 1px solid var(--gg-border); }
.plugin-action > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.plugin-action strong { font-size: 12px; }
.plugin-action span { color: var(--el-text-color-secondary); font-size: 10px; }
.plugin-detail__problem { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; margin-top: 18px; padding: 13px; border: 1px solid var(--el-color-danger-light-5); border-radius: 5px; color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.plugin-detail__problem svg { width: 18px; }
.plugin-detail__problem strong { font-size: 13px; }
.plugin-detail__problem pre { margin: 7px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--el-text-color-primary); font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
.plugin-detail--empty { display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; }
.plugin-detail--empty strong { font-size: 14px; }
.plugin-detail--empty p { max-width: 320px; margin: 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.5; }
.plugin-detail__empty-icon { width: 28px; height: 28px; color: var(--el-color-primary); }
@media (max-width: 860px) {
  .plugins-workspace { grid-template-columns: 196px minmax(0, 1fr); }
  .plugin-detail { padding: 14px; }
  .plugin-detail__facts { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .plugins-page__header { align-items: center; }
  .plugins-page__header p { display: none; }
  .plugins-page__actions > :first-child { padding-inline: 10px; }
  .plugins-workspace { grid-template-columns: 180px minmax(0, 1fr); }
  .plugin-detail__header { align-items: center; }
  .plugin-detail__header > .el-button { width: 32px; padding: 0; font-size: 0; }
}
</style>
