<script setup lang="ts">
/**
 * 设置窗口外壳:顶栏(暂停开关 / 深浅主题 / 语言)、导航、内容区、底部保存状态。
 * 深浅主题为本机偏好(localStorage,不入同步载荷);语言写 preferences.locale(同步)。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useDark, useToggle } from "@vueuse/core";
import {
  BookOpen,
  CirclePause,
  CirclePlay,
  FileText,
  Info,
  Moon,
  Puzzle,
  Settings,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-vue-next";
import {
  AppBadge,
  AppButton,
  AppEmptyState,
  AppSkeleton,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import { useConfigStore } from "./stores/config";
import { useAccountStore } from "./stores/account";
import { useUpdateStore } from "./stores/update";
import { usePluginsStore } from "./stores/plugins";
import { useTemplatesStore } from "./stores/templates";
import { resolveLocale, setLocale, type AppLocale } from "./locales";
import { listenForSingleInstance } from "./single-instance";
import {
  completeQuickGuide,
  isQuickGuideForced,
  resolveQuickGuideStorage,
  shouldShowQuickGuide,
} from "./onboarding/quick-guide";
import { resolveInitialSection, type Section } from "./shell";
import UiConfirmHost from "./components/UiConfirmHost.vue";
import UiMessageHost from "./components/UiMessageHost.vue";
import UiToastHost from "./components/UiToastHost.vue";
import QuickStartDialog from "./components/QuickStartDialog.vue";
import WindowControls from "./components/WindowControls.vue";
import OptionsView from "./views/OptionsView.vue";
import GesturesView from "./views/GesturesView.vue";
import AccountView from "./views/AccountView.vue";
import TemplatesView from "./views/TemplatesView.vue";
import PluginsView from "./views/PluginsView.vue";
import LogsView from "./views/LogsView.vue";
import AboutView from "./views/AboutView.vue";

type LocaleSetting = "auto" | AppLocale;

const { t } = useI18n();
const store = useConfigStore();
const account = useAccountStore();
const updates = useUpdateStore();
const plugins = usePluginsStore();
const templates = useTemplatesStore();
const { confirm } = useConfirmDialog();

const isDark = useDark();
const toggleDark = useToggle(isDark);
const active = ref<Section>("gestures");
const quickStartVisible = ref(false);
const workspaceHeading = ref<HTMLHeadingElement | null>(null);
const quickGuideStorage = resolveQuickGuideStorage();
let unlistenSingleInstance: (() => void) | undefined;

const SECTION_VIEWS = {
  options: OptionsView,
  gestures: GesturesView,
  templates: TemplatesView,
  plugins: PluginsView,
  logs: LogsView,
  account: AccountView,
  about: AboutView,
} as const;
const NAV_ITEMS: ReadonlyArray<{ id: Section; icon: LucideIcon }> = [
  { id: "gestures", icon: CirclePlay },
  { id: "templates", icon: BookOpen },
  { id: "plugins", icon: Puzzle },
  { id: "logs", icon: FileText },
  { id: "account", icon: UserRound },
  { id: "options", icon: Settings },
  { id: "about", icon: Info },
];
const currentView = computed(() => SECTION_VIEWS[active.value]);
const currentViewBindings = computed(() =>
  active.value === "about" ? { onOpenQuickStart: openQuickStart } : {},
);
const needsConfig = computed(() => !["account", "about", "plugins", "logs"].includes(active.value));
const quickStartIntents = computed(() => store.doc?.global.intents ?? []);
const isTauri = computed(() => store.backend.isTauri);
const isWindowsDesktop = computed(
  () =>
    isTauri.value &&
    typeof navigator !== "undefined" &&
    /Windows|Win32|Win64/i.test(`${navigator.platform} ${navigator.userAgent}`),
);
const saveStateKind = computed(() => {
  if (store.saveState === "saving") return "warning";
  if (store.saveState === "saved") return "success";
  return "danger";
});
const saveStateLabel = computed(() => {
  if (store.saveState === "saving") return t("footer.saving");
  if (store.saveState === "saved") return t("footer.saved");
  return t("footer.saveError");
});

const localeSetting = computed<LocaleSetting>({
  get: () => store.doc?.preferences.locale ?? "auto",
  set: (value) => {
    if (store.doc) store.doc.preferences.locale = value;
    setLocale(resolveLocale(value));
  },
});

function selectSection(section: Section): void {
  active.value = section;
  void focusWorkspaceHeading();
}

function setQuickStartVisible(visible: boolean): void {
  if (!visible) completeQuickGuide(quickGuideStorage);
  quickStartVisible.value = visible;
}

function openQuickStart(): void {
  quickStartVisible.value = true;
}

function openGuideDestination(destination: "gestures" | "templates"): void {
  selectSection(destination);
  setQuickStartVisible(false);
}

async function focusWorkspaceHeading(): Promise<void> {
  await nextTick();
  workspaceHeading.value?.focus();
}

watch(
  () => store.doc?.preferences.locale,
  (locale) => {
    if (locale) setLocale(resolveLocale(locale));
  },
);

watchEffect(() => {
  if (typeof document !== "undefined") document.title = t("app.title");
});

watch(
  [() => updates.automaticPromptPending, quickStartVisible],
  async ([pending, guideVisible]) => {
    if (!pending || guideVisible || !updates.metadata) return;
    updates.dismissAutomaticPrompt();
    const confirmed = await confirm({
      title: t("about.autoPrompt.title"),
      message: t("about.autoPrompt.body", { version: updates.metadata.version }),
      confirmLabel: t("about.autoPrompt.view"),
      cancelLabel: t("about.autoPrompt.later"),
    });
    if (confirmed) selectSection("about");
  },
);

onMounted(() => {
  void (async () => {
    if (!store.backend.isTauri && typeof window !== "undefined") {
      active.value = resolveInitialSection(window.location.search);
    }
    if (store.backend.isTauri) {
      unlistenSingleInstance = await listenForSingleInstance(() => {
        pushToast({ kind: "info", message: t("app.alreadyRunning") });
      });
    }
    void Promise.allSettled([templates.loadCatalog(true), plugins.loadOnlineCatalog(true)]);
    await store.load();
    if (!store.backend.isTauri && typeof window !== "undefined") {
      const previewParams = new URLSearchParams(window.location.search);
      if (previewParams.get("locale") === "en" && store.doc) {
        store.doc.preferences.locale = "en";
        setLocale("en");
      }
      if (previewParams.get("theme") === "dark") isDark.value = true;
    }
    await plugins.initialize();
    const forced =
      !store.backend.isTauri &&
      typeof window !== "undefined" &&
      isQuickGuideForced(window.location.search);
    const previewGuideDisabled =
      !store.backend.isTauri &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("guide") === "0";
    if (store.ready && !previewGuideDisabled && (forced || shouldShowQuickGuide(quickGuideStorage))) {
      quickStartVisible.value = true;
    }
    await account.initialize();
    const previewUpdatesDisabled =
      !store.backend.isTauri &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("updates") === "0";
    updates.scheduleAutomaticCheck(
      !previewUpdatesDisabled && (store.doc?.preferences.autoCheckForUpdate ?? false),
    );
  })();
});

onUnmounted(() => unlistenSingleInstance?.());
</script>

<template>
  <div class="app">
    <a class="app__skip-link" href="#workspace-main">{{ t("app.skipToMain") }}</a>
    <header class="app__header" :class="{ 'app__header--custom': isWindowsDesktop }">
      <div class="app__brand">
        <img src="../src-tauri/icons/32x32.png" alt="" />
        <span>{{ t("app.name") }}</span>
      </div>
      <div
        class="app__header-spacer"
        :data-tauri-drag-region="isWindowsDesktop ? '' : undefined"
      />
      <div class="app__actions">
        <AppButton
          class="app__pause-button"
          :variant="store.paused ? 'secondary' : 'primary'"
          size="sm"
          :title="t('header.pauseTooltip')"
          @click="store.togglePause()"
        >
          <CirclePlay v-if="store.paused" :size="16" aria-hidden="true" />
          <CirclePause v-else :size="16" aria-hidden="true" />
          <span class="app__pause-label">{{ store.paused ? t("header.paused") : t("header.running") }}</span>
        </AppButton>
        <button
          type="button"
          class="gg-icon-button app__theme-button"
          :aria-label="t('header.theme')"
          :title="t('header.theme')"
          @click="toggleDark()"
        >
          <Moon v-if="!isDark" :size="18" aria-hidden="true" />
          <Sun v-else :size="18" aria-hidden="true" />
        </button>
        <label class="app__language">
          <span class="gg-sr-only">{{ t("header.language") }}</span>
          <select v-model="localeSetting" class="gg-select app__language-select">
            <option value="auto">{{ t("header.languageAuto") }}</option>
            <option value="zh-CN">{{ t("header.languageZhCn") }}</option>
            <option value="en">{{ t("header.languageEn") }}</option>
          </select>
        </label>
      </div>
      <WindowControls v-if="isWindowsDesktop" />
    </header>

    <div class="app__body">
      <aside id="workspace-navigation" class="app__aside" :aria-label="t('header.navigation')">
        <nav class="app__navigation">
          <button
            v-for="item in NAV_ITEMS"
            :key="item.id"
            type="button"
            class="app__nav-item"
            :class="{ 'app__nav-item--active': active === item.id }"
            :aria-current="active === item.id ? 'page' : undefined"
            @click="selectSection(item.id)"
          >
            <component :is="item.icon" :size="18" aria-hidden="true" />
            <span>{{ t(`nav.${item.id}`) }}</span>
          </button>
        </nav>
      </aside>

      <main id="workspace-main" class="app__main" tabindex="-1">
        <h1 ref="workspaceHeading" class="gg-sr-only" tabindex="-1">{{ t(`nav.${active}`) }}</h1>
        <component
          :is="currentView"
          v-if="!needsConfig || store.ready"
          v-bind="currentViewBindings"
        />
        <AppEmptyState
          v-else-if="store.loadError"
          :title="t('load.title')"
          :description="t('load.description')"
        >
          <AppButton variant="primary" :loading="store.loading" :loading-label="t('load.retry')" @click="store.load()">
            {{ t("load.retry") }}
          </AppButton>
        </AppEmptyState>
        <div v-else class="app__loading" role="status" aria-live="polite" aria-busy="true">
          <span class="gg-sr-only">{{ t("load.loading") }}</span>
          <AppSkeleton v-for="index in 6" :key="index" :style="{ width: `${100 - index * 6}%` }" />
        </div>
      </main>
    </div>

    <footer class="app__footer">
      <span class="gg-hint">{{ t("footer.autoSave") }}</span>
      <span class="app__spacer" />
      <span v-if="store.saveState === 'saved'" class="app__footer-saved">
        <span class="app__footer-divider" aria-hidden="true" />
        <span class="app__footer-save-text">{{ saveStateLabel }}</span>
      </span>
      <AppBadge v-else-if="store.saveState !== 'idle'" :variant="saveStateKind">{{ saveStateLabel }}</AppBadge>
      <AppBadge v-if="!isTauri" variant="neutral">{{ t("footer.mockMode") }}</AppBadge>
    </footer>

    <QuickStartDialog
      :model-value="quickStartVisible"
      :intents="quickStartIntents"
      @update:model-value="setQuickStartVisible"
      @navigate="openGuideDestination"
    />
    <UiConfirmHost />
    <UiMessageHost />
    <UiToastHost />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr) auto;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--gg-text);
  background: var(--gg-canvas);
}

.app__skip-link {
  position: fixed;
  z-index: 100;
  top: 8px;
  left: 8px;
  transform: translateY(-160%);
  border-radius: 6px;
  padding: 8px 12px;
  background: var(--gg-primary);
  color: var(--gg-on-primary);
  text-decoration: none;
}

.app__skip-link:focus {
  transform: translateY(0);
}

.app__header {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--gg-border);
  background: var(--gg-surface);
}

.app__header--custom {
  padding-right: 0;
}

.app__brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--gg-text);
  font-size: 15px;
  font-weight: 600;
}

.app__brand img {
  width: 22px;
  height: 22px;
}

.app__header-spacer {
  align-self: stretch;
  min-width: 12px;
  flex: 1 1 auto;
}

.app__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app__language-select {
  width: 116px;
  min-height: 32px;
  height: 32px;
  padding-top: 0;
  padding-bottom: 0;
}

.app__pause-button {
  min-height: 32px;
  height: 32px;
  padding-right: 10px;
  padding-left: 10px;
}

.app__theme-button {
  width: 32px;
  min-width: 32px;
  height: 32px;
  min-height: 32px;
}

.app__body {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: 168px minmax(0, 1fr);
  overflow: hidden;
}

.app__aside {
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--gg-border);
  background: var(--gg-sidebar);
}

.app__navigation {
  display: grid;
  gap: 2px;
  padding: 8px;
}

.app__nav-item {
  display: flex;
  min-height: 38px;
  height: 38px;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 0 10px;
  color: var(--gg-text-muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

.app__nav-item:hover {
  color: var(--gg-text);
  background: var(--gg-surface-muted);
}

.app__nav-item--active {
  border-color: var(--gg-primary-border);
  color: var(--gg-primary);
  background: var(--gg-primary-soft);
  font-weight: 650;
}

.app__main {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px 16px;
  background: var(--gg-canvas);
}

.app__loading {
  display: grid;
  gap: 12px;
  max-width: 860px;
  padding: 8px 0;
}

.app__loading :deep(.gg-skeleton) {
  height: 18px;
}

.app__footer {
  display: flex;
  min-width: 0;
  min-height: 30px;
  height: 30px;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--gg-border);
  padding: 0 16px;
  font-size: 12px;
  background: var(--gg-surface);
}

.app__spacer {
  flex: 1 1 auto;
}

.app__footer-saved {
  display: inline-flex;
  height: calc(100% + 1px);
  min-height: 0;
  align-self: stretch;
  margin-top: -1px;
  align-items: center;
  gap: 12px;
  color: var(--gg-success);
  white-space: nowrap;
}

.app__footer-divider {
  display: block;
  width: 1px;
  min-width: 1px;
  height: 100%;
  background: var(--gg-border-strong);
}

</style>

<style>
.gg-page {
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  overflow: hidden;
}

.gg-page__header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.gg-page__header h2 {
  margin: 0;
  color: var(--gg-text);
  font-size: 20px;
  font-weight: 650;
  line-height: 1.25;
}

.gg-page__scroll {
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.gg-page__stack {
  display: flex;
  min-width: 0;
  max-width: 100%;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.gg-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  padding: 16px;
  background: var(--gg-surface);
}

.gg-section-title {
  margin: 0 0 2px;
  color: var(--gg-text);
  font-size: 16px;
}

.gg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gg-field-label {
  color: var(--gg-text);
  font-size: 13px;
  font-weight: 600;
}

.gg-hint {
  margin: 0;
  color: var(--gg-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.gg-switch-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--gg-text);
  font-size: 14px;
}

.gg-unit,
.gg-info {
  color: var(--gg-text-muted);
}

.gg-info {
  cursor: help;
}
</style>
