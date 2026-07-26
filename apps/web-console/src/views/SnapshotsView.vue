<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import type { SnapshotMeta } from "@godgesture/shared";
import { listSnapshots, restoreSnapshot } from "../api/sync";
import { formatBytes, formatDateTime } from "../utils/format";
import { errorMessageKey } from "../utils/errors";

const { t, locale } = useI18n();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const snapshots = ref<SnapshotMeta[]>([]);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    snapshots.value = (await listSnapshots()).snapshots;
  } catch (err) {
    errorKey.value = errorMessageKey(err);
  } finally {
    loading.value = false;
  }
}

async function onRestore(snapshot: SnapshotMeta): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("snapshots.restoreConfirm", { version: snapshot.version }),
      t("snapshots.restoreConfirmTitle"),
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
    const result = await restoreSnapshot(snapshot.version);
    ElMessage.success(t("snapshots.restoreSuccess", { version: result.version }));
    await load();
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <div class="page-head">
      <h2>{{ t("snapshots.title") }}</h2>
      <el-button size="small" @click="load">{{ t("common.refresh") }}</el-button>
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
              <el-button text type="primary" size="small" @click="onRestore(row)">
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
}

.page-head h2 {
  margin: 0;
}
</style>
