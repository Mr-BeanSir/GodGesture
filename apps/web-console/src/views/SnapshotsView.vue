<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import type { SnapshotMeta } from "@godgesture/shared";
import { listSnapshots, pullConfig, restoreSnapshot } from "../api/sync";
import { ApiError } from "../api/client";
import { formatBytes, formatDateTime } from "../utils/format";
import { errorMessageKey } from "../utils/errors";

const { t, locale } = useI18n();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const snapshots = ref<SnapshotMeta[]>([]);
const currentVersion = ref<number | null>(null);
const restoringVersion = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  currentVersion.value = null;
  try {
    const [snapshotResult, configResult] = await Promise.all([
      listSnapshots(),
      pullConfig(),
    ]);
    snapshots.value = snapshotResult.snapshots;
    currentVersion.value = configResult.version;
  } catch (err) {
    snapshots.value = [];
    errorKey.value = errorMessageKey(err);
  } finally {
    loading.value = false;
  }
}

async function onRestore(snapshot: SnapshotMeta): Promise<void> {
  if (restoringVersion.value !== null || currentVersion.value === null) return;
  restoringVersion.value = snapshot.version;
  const baseVersion = currentVersion.value;
  try {
    await ElMessageBox.confirm(
      t("snapshots.restoreConfirm", {
        version: snapshot.version,
        currentVersion: baseVersion,
      }),
      t("snapshots.restoreConfirmTitle"),
      {
        confirmButtonText: t("common.confirm"),
        cancelButtonText: t("common.cancel"),
        type: "warning",
      },
    );
  } catch {
    restoringVersion.value = null;
    return; // 取消
  }
  try {
    const result = await restoreSnapshot(snapshot.version, { baseVersion });
    ElMessage.success(t("snapshots.restoreSuccess", { version: result.version }));
    await load();
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 409 &&
      err.code === "version_conflict"
    ) {
      ElMessage.warning(t("snapshots.restoreConflict"));
      // 只刷新，不自动重试。用户必须根据新版本重新确认一次回滚。
      await load();
    } else {
      ElMessage.error(t(errorMessageKey(err)));
    }
  } finally {
    restoringVersion.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <div class="page-head">
      <div class="page-title">
        <h2>{{ t("snapshots.title") }}</h2>
        <span v-if="currentVersion !== null" class="current-version">
          {{ t("snapshots.currentVersion", { version: currentVersion }) }}
        </span>
      </div>
      <el-button
        size="small"
        :disabled="loading || restoringVersion !== null"
        @click="load"
      >
        {{ t("common.refresh") }}
      </el-button>
    </div>
    <el-alert
      v-if="errorKey"
      type="error"
      :title="t(errorKey)"
      :closable="false"
      class="page-card"
    />
    <template v-else>
      <el-empty
        v-if="!loading && snapshots.length === 0"
        :description="t('snapshots.empty')"
      />
      <el-card v-else class="page-card">
        <el-table :data="snapshots" size="small">
          <el-table-column :label="t('snapshots.version')" width="100">
            <template #default="{ row }">v{{ row.version }}</template>
          </el-table-column>
          <el-table-column :label="t('snapshots.createdAt')" min-width="180">
            <template #default="{ row }">
              {{ formatDateTime(row.createdAt, locale) }}
            </template>
          </el-table-column>
          <el-table-column :label="t('snapshots.device')" min-width="160">
            <template #default="{ row }">
              {{ row.deviceName ?? t("overview.unknownDevice") }}
            </template>
          </el-table-column>
          <el-table-column :label="t('snapshots.size')" width="120">
            <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="160" align="right">
            <template #default="{ row }">
              <el-button
                text
                type="primary"
                size="small"
                :loading="restoringVersion === row.version"
                :disabled="
                  loading || currentVersion === null || restoringVersion !== null
                "
                @click="onRestore(row)"
              >
                {{ t("snapshots.restore") }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.page-head h2 {
  margin: 0;
}

.page-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}

.current-version {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
