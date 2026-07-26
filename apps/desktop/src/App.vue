<script setup lang="ts">
/**
 * 设置窗口外壳:顶栏(暂停开关 / 深浅主题 / 语言)、左侧导航、内容区、底部保存状态。
 * 深浅主题为本机偏好(localStorage,不入同步载荷);语言写 preferences.locale(同步)。
 */
import { computed, onMounted, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useDark, useToggle } from "@vueuse/core";
import { Moon, Sunny, VideoPlay, VideoPause } from "@element-plus/icons-vue";
import { useConfigStore } from "./stores/config";
import { resolveLocale, setLocale, type AppLocale } from "./locales";
import OptionsView from "./views/OptionsView.vue";
import GesturesView from "./views/GesturesView.vue";
import CornersEdgesView from "./views/CornersEdgesView.vue";
import AccountView from "./views/AccountView.vue";
import AboutView from "./views/AboutView.vue";

type Section = "options" | "gestures" | "cornersEdges" | "account" | "about";
type LocaleSetting = "auto" | AppLocale;

const { t } = useI18n();
const store = useConfigStore();

const isDark = useDark();
const toggleDark = useToggle(isDark);

const active = ref<Section>("options");
const SECTION_VIEWS = {
  options: OptionsView,
  gestures: GesturesView,
  cornersEdges: CornersEdgesView,
  account: AccountView,
  about: AboutView,
} as const;
const currentView = computed(() => SECTION_VIEWS[active.value]);
const needsConfig = computed(() => active.value !== "account" && active.value !== "about");

const localeSetting = computed<LocaleSetting>({
  get: () => store.doc?.preferences.locale ?? "auto",
  set: (v) => {
    if (store.doc) store.doc.preferences.locale = v;
    setLocale(resolveLocale(v));
  },
});

const isTauri = computed(() => store.backend.isTauri);

function onSelectSection(index: string) {
  active.value = index as Section;
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

onMounted(() => store.load());
</script>

<template>
  <el-container class="app">
    <el-header class="app__header">
      <div class="app__brand">{{ t("app.title") }}</div>
      <div class="app__actions">
        <el-tooltip :content="t('header.pauseTooltip')" placement="bottom">
          <el-button
            :type="store.paused ? 'warning' : 'success'"
            :icon="store.paused ? VideoPlay : VideoPause"
            round
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
      <el-aside width="180px" class="app__aside">
        <el-menu :default-active="active" class="app__menu" @select="onSelectSection">
          <el-menu-item index="options">{{ t("nav.options") }}</el-menu-item>
          <el-menu-item index="gestures">{{ t("nav.gestures") }}</el-menu-item>
          <el-menu-item index="cornersEdges">{{ t("nav.cornersEdges") }}</el-menu-item>
          <el-menu-item index="account">{{ t("nav.account") }}</el-menu-item>
          <el-menu-item index="about">{{ t("nav.about") }}</el-menu-item>
        </el-menu>
      </el-aside>

      <el-main class="app__main">
        <component :is="currentView" v-if="!needsConfig || store.ready" />
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
  </el-container>
</template>

<style scoped>
.app {
  height: 100vh;
}
.app__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--el-border-color-lighter);
  height: 52px;
}
.app__brand {
  font-weight: 600;
  font-size: 15px;
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
  overflow: hidden;
}
.app__aside {
  border-right: 1px solid var(--el-border-color-lighter);
}
.app__menu {
  border-right: none;
  height: 100%;
}
.app__main {
  overflow-y: auto;
  background: var(--el-fill-color-blank);
}
.app__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  border-top: 1px solid var(--el-border-color-lighter);
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
.gg-section {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 16px 18px;
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
</style>
