<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import type { OAuthProvider } from "@godgesture/shared";
import { useAuthStore } from "../stores/auth";

const { t } = useI18n();
const router = useRouter();
const auth = useAuthStore();

const ALL_PROVIDERS: OAuthProvider[] = ["github", "google", "wechat", "qq"];

const linkedProviders = computed(
  () => new Set(auth.user?.linkedProviders ?? []),
);

async function onLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm(t("auth.logoutConfirm"), t("auth.logout"), {
      confirmButtonText: t("common.confirm"),
      cancelButtonText: t("common.cancel"),
      type: "warning",
    });
  } catch {
    return; // 取消
  }
  const outcome = await auth.logout();
  if (outcome === "local_only") {
    ElMessage.warning(t("auth.logoutLocalOnly"));
  }
  void router.replace({ name: "login" });
}
</script>

<template>
  <div>
    <h2 class="page-title">{{ t("security.title") }}</h2>

    <el-card class="page-card">
      <template #header>{{ t("security.linkedProviders") }}</template>
      <el-descriptions :column="1" border>
        <el-descriptions-item
          v-for="provider in ALL_PROVIDERS"
          :key="provider"
          :label="t(`provider.${provider}`)"
        >
          <el-tag
            v-if="linkedProviders.has(provider)"
            type="success"
            size="small"
          >
            {{ t("security.bound") }}
          </el-tag>
          <el-tag v-else type="info" size="small">
            {{ t("security.notBound") }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="page-card">
      <template #header>{{ t("security.session") }}</template>
      <p class="hint">{{ t("security.logoutHint") }}</p>
      <el-button type="danger" @click="onLogout">
        {{ t("auth.logout") }}
      </el-button>
    </el-card>
  </div>
</template>

<style scoped>
.page-title {
  margin-top: 0;
}

.hint {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
