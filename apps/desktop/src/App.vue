<script setup lang="ts">
/**
 * 设置窗口外壳:顶栏(暂停开关 / 深浅主题 / 语言)、左侧导航、内容区、底部保存状态。
 * 深浅主题为本机偏好(localStorage,不入同步载荷);语言写 preferences.locale(同步)。
 */
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useDark, useToggle } from "@vueuse/core";
import {
  Aim,
  Connection,
  InfoFilled,
  MagicStick,
  Moon,
  Setting,
  Sunny,
  User,
  VideoPause,
  VideoPlay,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import { useConfigStore } from "./stores/config";
import { useAccountStore } from "./stores/account";
import { useUpdateStore } from "./stores/update";
import { resolveLocale, setLocale, type AppLocale } from "./locales";
import { listenForSingleInstance } from "./single-instance";
import {
  completeQuickGuide,
  isQuickGuideForced,
  resolveQuickGuideStorage,
  shouldShowQuickGuide,
} from "./onboarding/quick-guide";
import LegacyImportDialog from "./components/LegacyImportDialog.vue";
import QuickStartDialog from "./components/QuickStartDialog.vue";
import OptionsView from "./views/OptionsView.vue";
import GesturesView from "./views/GesturesView.vue";
import CornersEdgesView from "./views/CornersEdgesView.vue";
import AccountView from "./views/AccountView.vue";
import TemplatesView from "./views/TemplatesView.vue";
import AboutView from "./views/AboutView.vue";

type Section = "options" | "gestures" | "cornersEdges" | "templates" | "account" | "about";
type LocaleSetting = "auto" | AppLocale;

const { t, locale } = useI18n();
const store = useConfigStore();
const account = useAccountStore();
const updates = useUpdateStore();

const isDark = useDark();
const toggleDark = useToggle(isDark);

const active = ref<Section>("options");
const quickStartVisible = ref(false);
const legacyImportVisible = ref(false);
const quickGuideStorage = resolveQuickGuideStorage();
let unlistenSingleInstance: (() => void) | undefined;
const SECTION_VIEWS = {
  options: OptionsView,
  gestures: GesturesView,
  cornersEdges: CornersEdgesView,
  templates: TemplatesView,
  account: AccountView,
  about: AboutView,
} as const;
const NAV_ITEMS = [
  { id: "gestures", icon: MagicStick },
  { id: "cornersEdges", icon: Aim },
  { id: "templates", icon: Connection },
  { id: "account", icon: User },
  { id: "options", icon: Setting },
  { id: "about", icon: InfoFilled },
] as const satisfies ReadonlyArray<{ id: Section; icon: typeof MagicStick }>;
const currentView = computed(() => SECTION_VIEWS[active.value]);
const currentViewBindings = computed(() => {
  if (active.value === "options") {
    return { onOpenLegacyImport: openLegacyImport };
  }
  if (active.value === "about") {
    return { onOpenQuickStart: openQuickStart };
  }
  return {};
});
const needsConfig = computed(() => active.value !== "account" && active.value !== "about");
const quickStartIntents = computed(() => store.doc?.global.intents ?? []);

const localeSetting = computed<LocaleSetting>({
  get: () => store.doc?.preferences.locale ?? "auto",
  set: (v) => {
    if (store.doc) store.doc.preferences.locale = v;
    setLocale(resolveLocale(v));
  },
});

const isTauri = computed(() => store.backend.isTauri);
const elementLocale = computed(() => (locale.value === "zh-CN" ? zhCn : en));

function onSelectSection(index: string) {
  active.value = index as Section;
}

function setQuickStartVisible(visible: boolean) {
  if (!visible) completeQuickGuide(quickGuideStorage);
  quickStartVisible.value = visible;
}

function openQuickStart() {
  quickStartVisible.value = true;
}

function openGuideDestination(destination: "gestures" | "templates") {
  active.value = destination;
  setQuickStartVisible(false);
}

function openLegacyImport() {
  active.value = "options";
  setQuickStartVisible(false);
  legacyImportVisible.value = true;
}

// 配置载入后应用已保存的语言
watch(
  () => store.doc?.preferences.locale,
  (loc) => {
    if (loc) setLocale(resolveLocale(loc));
  },
);

watchEffect(() => {
  if (typeof document !== "undefined") document.title = t("app.title");
});

watch(
  [() => updates.automaticPromptPending, quickStartVisible, legacyImportVisible],
  async ([pending, guideVisible, importVisible]) => {
    if (!pending || guideVisible || importVisible || !updates.metadata) return;
    updates.dismissAutomaticPrompt();
    try {
      await ElMessageBox.confirm(
        t("about.autoPrompt.body", { version: updates.metadata.version }),
        t("about.autoPrompt.title"),
        {
          confirmButtonText: t("about.autoPrompt.view"),
          cancelButtonText: t("about.autoPrompt.later"),
          type: "info",
        },
      );
      active.value = "about";
    } catch {
      // The session-level prompt is intentionally non-blocking.
    }
  },
);

onMounted(() => {
  void (async () => {
    if (store.backend.isTauri) {
      unlistenSingleInstance = await listenForSingleInstance(() => {
        ElMessage.info(t("app.alreadyRunning"));
      });
    }
    await store.load();
    const forced =
      !store.backend.isTauri &&
      typeof window !== "undefined" &&
      isQuickGuideForced(window.location.search);
    if (store.ready && (forced || shouldShowQuickGuide(quickGuideStorage))) {
      quickStartVisible.value = true;
    }
    await account.initialize();
    updates.scheduleAutomaticCheck(
      store.doc?.preferences.autoCheckForUpdate ?? false,
    );
  })();
});

onUnmounted(() => unlistenSingleInstance?.());
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <el-container class="app">
    <el-header class="app__header">
      <div class="app__brand">
        <img src="../src-tauri/icons/32x32.png" alt="" />
        <span>{{ t("app.title") }}</span>
      </div>
      <div class="app__actions">
        <el-tooltip :content="t('header.pauseTooltip')" placement="bottom">
          <el-button
            :type="store.paused ? 'warning' : 'success'"
            :icon="store.paused ? VideoPlay : VideoPause"
            size="small"
            @click="store.togglePause()"
          >
            {{ store.paused ? t("header.paused") : t("header.running") }}
          </el-button>
        </el-tooltip>

        <el-tooltip :content="t('header.theme')" placement="bottom">
          <el-button circle size="small" @click="toggleDark()">
            <el-icon><Moon v-if="!isDark" /><Sunny v-else /></el-icon>
          </el-button>
        </el-tooltip>

        <el-select v-model="localeSetting" size="small" class="app__lang">
          <el-option :label="t('header.languageAuto')" value="auto" />
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en" />
        </el-select>
      </div>
    </el-header>

    <el-container class="app__body">
      <el-aside width="168px" class="app__aside">
        <el-menu :default-active="active" class="app__menu" @select="onSelectSection">
          <el-menu-item v-for="item in NAV_ITEMS" :key="item.id" :index="item.id">
            <el-icon><component :is="item.icon" /></el-icon>
            <el-tooltip
              :content="t(`nav.${item.id}`)"
              placement="right"
              :show-after="450"
            >
              <span class="app__nav-label">{{ t(`nav.${item.id}`) }}</span>
            </el-tooltip>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main class="app__main">
        <component
          :is="currentView"
          v-if="!needsConfig || store.ready"
          v-bind="currentViewBindings"
        />
        <el-result
          v-else-if="store.loadError"
          icon="error"
          :title="t('load.title')"
          :sub-title="t('load.description')"
        >
          <template #extra>
            <el-button type="primary" :loading="store.loading" @click="store.load()">
              {{ t("load.retry") }}
            </el-button>
          </template>
        </el-result>
        <el-skeleton v-else :rows="6" animated />
      </el-main>
    </el-container>

    <el-footer class="app__footer">
      <span class="gg-hint">{{ t("footer.autoSave") }}</span>
      <span class="app__spacer" />
      <span v-if="store.saveState === 'saving'" class="app__save app__save--busy">{{ t("footer.saving") }}</span>
      <span v-else-if="store.saveState === 'saved'" class="app__save app__save--ok">{{ t("footer.saved") }}</span>
      <span v-else-if="store.saveState === 'error'" class="app__save app__save--err">{{ t("footer.saveError") }}</span>
      <el-tag v-if="!isTauri" type="info" size="small" class="app__mock">{{ t("footer.mockMode") }}</el-tag>
    </el-footer>

    <QuickStartDialog
      :model-value="quickStartVisible"
      :intents="quickStartIntents"
      @update:model-value="setQuickStartVisible"
      @navigate="openGuideDestination"
      @open-legacy-import="openLegacyImport"
    />
    <LegacyImportDialog v-model="legacyImportVisible" />
    </el-container>
  </el-config-provider>
</template>

<style scoped>
.app {
  height: 100vh;
  min-width: 0;
  min-height: 0;
  color: var(--el-text-color-primary);
  background: var(--gg-canvas);
}
.app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 48px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--gg-border);
  background: var(--gg-surface);
}
.app__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 15px;
}
.app__brand img {
  width: 22px;
  height: 22px;
}
.app__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.app__lang {
  width: 116px;
}
.app__body {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.app__aside {
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--gg-border);
  background: var(--gg-sidebar);
}
.app__menu {
  border-right: none;
  height: 100%;
  padding: 8px;
  background: transparent;
}
.app__menu :deep(.el-menu-item) {
  height: 38px;
  margin-bottom: 2px;
  padding: 0 10px !important;
  border-radius: 5px;
  font-size: 13px;
}
.app__menu :deep(.el-menu-item .el-icon) {
  width: 18px;
  margin-right: 8px;
}
.app__nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app__main {
  min-width: 0;
  min-height: 0;
  padding: 14px 16px;
  overflow: hidden;
  background: var(--gg-canvas);
}
.app__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 30px;
  height: 30px;
  padding: 0 16px;
  border-top: 1px solid var(--gg-border);
  background: var(--gg-surface);
  font-size: 12px;
}
.app__spacer {
  flex: 1;
}
.app__save--busy {
  color: var(--el-color-warning);
}
.app__save--ok {
  color: var(--el-color-success);
}
.app__save--err {
  color: var(--el-color-danger);
}
</style>

<style>
/* 全局基础样式与跨组件工具类 */
html,
body,
#app {
  height: 100%;
  margin: 0;
}
#app {
  font-family: "Segoe UI", "Microsoft YaHei", Inter, system-ui, sans-serif;
}
:root {
  --gg-canvas: #f5f6f7;
  --gg-surface: #ffffff;
  --gg-sidebar: #fafafa;
  --gg-border: #dfe2e6;
  --gg-panel-muted: #f8f9fa;
}
html.dark {
  --gg-canvas: #17191c;
  --gg-surface: #202328;
  --gg-sidebar: #1c1f23;
  --gg-border: #34383f;
  --gg-panel-muted: #25292e;
}
.gg-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}
.gg-page__header h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.35;
}
.gg-page__scroll {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
.gg-page__stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding-right: 4px;
}
.gg-section {
  background: var(--gg-surface);
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gg-section-title {
  margin: 0 0 2px;
  font-size: 15px;
}
.gg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gg-field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}
.gg-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.gg-switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.gg-unit {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.gg-info {
  color: var(--el-text-color-secondary);
  cursor: help;
}
@media (max-width: 860px) {
  .app__main {
    padding: 12px;
  }
}
</style>
