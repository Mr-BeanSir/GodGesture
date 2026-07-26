<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import type { DeviceInfo } from "@godgesture/shared";
import { deleteDevice, listDevices, renameDevice } from "../api/devices";
import { useAuthStore } from "../stores/auth";
import { formatDateTime } from "../utils/format";
import { errorMessageKey } from "../utils/errors";

const { t, locale } = useI18n();
const router = useRouter();
const auth = useAuthStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const devices = ref<DeviceInfo[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    devices.value = (await listDevices()).devices;
  } catch (err) {
    errorKey.value = errorMessageKey(err);
  } finally {
    loading.value = false;
  }
}

async function onRename(device: DeviceInfo): Promise<void> {
  let name: string;
  try {
    const { value } = await ElMessageBox.prompt(
      t("devices.renamePlaceholder"),
      t("devices.renameTitle"),
      {
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
        inputValue: device.name,
        inputValidator: (v) =>
          typeof v === "string" && v.trim().length > 0 && v.trim().length <= 64
            ? true
            : t("errors.validation_failed"),
      },
    );
    name = value.trim();
  } catch {
    return; // 取消
  }
  try {
    await renameDevice(device.id, name);
    ElMessage.success(t("devices.renameSuccess"));
    await load();
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  }
}

async function onKick(device: DeviceInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      device.current
        ? t("devices.kickCurrentConfirm")
        : t("devices.kickConfirm", { name: device.name }),
      t("devices.kickConfirmTitle"),
      {
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      },
    );
  } catch {
    return; // 取消
  }
  try {
    await deleteDevice(device.id);
    ElMessage.success(t("devices.kickSuccess"));
    if (device.current) {
      // 踢下线当前设备 = 登出:本地清理并回登录页
      auth.resetLocal();
      void router.push({ name: "login" });
    } else {
      await load();
    }
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <div class="page-head">
      <h2>{{ t("devices.title") }}</h2>
      <el-button size="small" @click="load">{{ t("common.refresh") }}</el-button>
    </div>
    <el-alert
      v-if="errorKey"
      type="error"
      :title="t(errorKey)"
      :closable="false"
      class="page-card"
    />
    <el-card v-else class="page-card">
      <el-table :data="devices" size="small">
        <el-table-column :label="t('devices.name')" min-width="200">
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <el-tag v-if="row.current" type="success" size="small" class="row-tag">
              {{ t("devices.current") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('devices.platform')" width="120">
          <template #default="{ row }">
            {{ t(`platform.${row.platform}`) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('devices.lastSeenAt')" min-width="180">
          <template #default="{ row }">
            {{
              row.lastSeenAt
                ? formatDateTime(row.lastSeenAt, locale)
                : t("common.never")
            }}
          </template>
        </el-table-column>
        <el-table-column :label="t('devices.createdAt')" min-width="180">
          <template #default="{ row }">
            {{ formatDateTime(row.createdAt, locale) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="160" align="right">
          <template #default="{ row }">
            <el-button text size="small" @click="onRename(row)">
              {{ t("devices.rename") }}
            </el-button>
            <el-button text type="danger" size="small" @click="onKick(row)">
              {{ t("devices.kick") }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-head h2 {
  margin: 0;
}

.row-tag {
  margin-left: 8px;
}
</style>
