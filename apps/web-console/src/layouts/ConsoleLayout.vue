<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  DataAnalysis,
  Document,
  Monitor,
  Clock,
  Lock,
  SwitchButton,
} from "@element-plus/icons-vue";
import { useAuthStore } from "../stores/auth";
import { setLocale, type ConsoleLocale } from "../i18n";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const navItems = computed(() => [
  { name: "overview", label: t("nav.overview"), icon: DataAnalysis },
  { name: "config", label: t("nav.config"), icon: Document },
  { name: "devices", label: t("nav.devices"), icon: Monitor },
  { name: "snapshots", label: t("nav.snapshots"), icon: Clock },
  { name: "security", label: t("nav.security"), icon: Lock },
]);

const activeName = computed(() => (route.name as string) ?? "overview");

function onSelect(name: string): void {
  void router.push({ name });
}

function switchLocale(value: string): void {
  setLocale(value as ConsoleLocale);
}

async function onLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm(t("auth.logoutConfirm"), t("auth.logout"), {
      confirmButtonText: t("common.confirm"),
      cancelButtonText: t("common.cancel"),
      type: "warning",
    });
  } catch {
    return;
  }
  const outcome = await auth.logout();
  if (outcome === "local_only") {
    ElMessage.warning(t("auth.logoutLocalOnly"));
  }
  void router.replace({ name: "login" });
}
</script>

<template>
  <el-container class="console">
    <el-aside width="220px" class="console-aside">
      <div class="brand">{{ t("app.title") }}</div>
      <el-menu :default-active="activeName" @select="onSelect">
        <el-menu-item
          v-for="item in navItems"
          :key="item.name"
          :index="item.name"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="console-header">
        <div class="spacer" />
        <el-select
          :model-value="locale"
          class="locale-select"
          size="small"
          @change="switchLocale"
        >
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en" />
        </el-select>
        <span v-if="auth.user?.email" class="user-email">{{
          auth.user.email
        }}</span>
        <el-button
          text
          :icon="SwitchButton"
          :title="t('auth.logout')"
          @click="onLogout"
        >
          {{ t("auth.logout") }}
        </el-button>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.console {
  height: 100%;
}

.console-aside {
  border-right: 1px solid var(--el-border-color-light);
  background-color: var(--el-bg-color);
}

.brand {
  padding: 18px 16px;
  font-weight: 600;
  font-size: 16px;
}

.console-aside .el-menu {
  border-right: none;
}

.console-header {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  background-color: var(--el-bg-color);
}

.spacer {
  flex: 1;
}

.locale-select {
  width: 120px;
}

.user-email {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
