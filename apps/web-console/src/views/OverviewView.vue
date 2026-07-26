<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ListDevicesResponse, PullConfigResponse } from "@godgesture/shared";
import { pullConfig } from "../api/sync";
import { listDevices } from "../api/devices";
import { useAuthStore } from "../stores/auth";
import { formatDateTime } from "../utils/format";
import { errorMessageKey } from "../utils/errors";

const { t, locale } = useI18n();
const auth = useAuthStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const syncMeta = ref<Omit<PullConfigResponse, "document"> | null>(null);
const devices = ref<ListDevicesResponse["devices"]>([]);

const lastSyncDeviceName = computed(() => {
  const id = syncMeta.value?.updatedByDeviceId;
  if (!id) return t("overview.unknownDevice");
  return (
    devices.value.find((d) => d.id === id)?.name ?? t("overview.unknownDevice")
  );
});

onMounted(async () => {
  try {
    const [pull, deviceList] = await Promise.all([pullConfig(), listDevices()]);
    // 概览只展示元数据,不渲染 document 全文
    syncMeta.value = {
      version: pull.version,
      updatedAt: pull.updatedAt,
      updatedByDeviceId: pull.updatedByDeviceId,
    };
    devices.value = deviceList.devices;
  } catch (err) {
    errorKey.value = errorMessageKey(err);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading">
    <el-alert
      v-if="errorKey"
      type="error"
      :title="t(errorKey)"
      :closable="false"
      class="page-card"
    />
    <el-card class="page-card">
      <template #header>{{ t("overview.account") }}</template>
      <el-descriptions v-if="auth.user" :column="1" border>
        <el-descriptions-item :label="t('overview.email')">
          {{ auth.user.email ?? t("overview.emailNone") }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('overview.userId')">
          {{ auth.user.id }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('overview.createdAt')">
          {{ formatDateTime(auth.user.createdAt, locale) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('overview.linkedProviders')">
          <template v-if="auth.user.linkedProviders.length > 0">
            <el-tag
              v-for="p in auth.user.linkedProviders"
              :key="p"
              class="provider-tag"
            >
              {{ t(`provider.${p}`) }}
            </el-tag>
          </template>
          <span v-else>{{ t("overview.linkedNone") }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
    <el-card class="page-card">
      <template #header>{{ t("overview.sync") }}</template>
      <template v-if="syncMeta">
        <el-empty
          v-if="syncMeta.version === 0"
          :description="t('overview.noConfig')"
        />
        <el-descriptions v-else :column="1" border>
          <el-descriptions-item :label="t('overview.version')">
            v{{ syncMeta.version }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('overview.updatedAt')">
            {{
              syncMeta.updatedAt
                ? formatDateTime(syncMeta.updatedAt, locale)
                : t("common.never")
            }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('overview.updatedByDevice')">
            {{ lastSyncDeviceName }}
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.provider-tag {
  margin-right: 6px;
}
</style>
