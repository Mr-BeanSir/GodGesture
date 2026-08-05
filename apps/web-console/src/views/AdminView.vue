<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { CircleCheck, CircleClose, Key, Refresh } from "@element-plus/icons-vue";
import type { AdminUser } from "@godgesture/shared";
import {
  listAdminUsers,
  revokeAdminUserSessions,
  setAdminUserRole,
  setAdminUserState,
} from "../api/admin";
import { errorMessageKey } from "../utils/errors";

const { t } = useI18n();
const users = ref<AdminUser[]>([]);
const total = ref(0);
const loading = ref(false);

async function loadUsers(): Promise<void> {
  loading.value = true;
  try {
    const result = await listAdminUsers();
    users.value = result.users;
    total.value = result.total;
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  } finally {
    loading.value = false;
  }
}

async function toggleState(user: AdminUser): Promise<void> {
  const disabled = !user.disabled;
  try {
    await ElMessageBox.confirm(
      disabled ? t("admin.disableConfirm") : t("admin.enableConfirm"),
      t("admin.accountState"),
      { type: disabled ? "warning" : "info" },
    );
    await setAdminUserState(user.id, { disabled });
    user.disabled = disabled;
    ElMessage.success(t(disabled ? "admin.disabled" : "admin.enabled"));
  } catch (err) {
    if (err === "cancel" || err === "close") return;
    ElMessage.error(t(errorMessageKey(err)));
  }
}

async function toggleRole(user: AdminUser): Promise<void> {
  const role = user.role === "admin" ? "user" : "admin";
  try {
    await ElMessageBox.confirm(
      t("admin.roleConfirm", { role: t("admin.roles." + role) }),
      t("admin.role"),
      { type: "warning" },
    );
    await setAdminUserRole(user.id, { role });
    user.role = role;
    ElMessage.success(t("admin.roleUpdated"));
  } catch (err) {
    if (err === "cancel" || err === "close") return;
    ElMessage.error(t(errorMessageKey(err)));
  }
}

async function revokeSessions(user: AdminUser): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.revokeConfirm"),
      t("admin.revokeSessions"),
      { type: "warning" },
    );
    await revokeAdminUserSessions(user.id);
    ElMessage.success(t("admin.sessionsRevoked"));
  } catch (err) {
    if (err === "cancel" || err === "close") return;
    ElMessage.error(t(errorMessageKey(err)));
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

onMounted(loadUsers);
</script>

<template>
  <section class="admin-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ t("nav.admin") }}</p>
        <h1>{{ t("admin.title") }}</h1>
        <p class="hint">{{ t("admin.hint") }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadUsers">
        {{ t("common.refresh") }}
      </el-button>
    </header>
    <el-card shadow="never" class="admin-table-card">
      <el-table v-loading="loading" :data="users" stripe>
        <el-table-column prop="email" :label="t('admin.email')" min-width="220">
          <template #default="{ row }">
            <span>{{ row.email || t("admin.noEmail") }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.role')" width="130">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'warning' : 'info'" size="small">
              {{ t("admin.roles." + row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.verified')" width="120">
          <template #default="{ row }">
            <el-tag :type="row.emailVerified ? 'success' : 'warning'" size="small">
              {{ row.emailVerified ? t("common.yes") : t("common.no") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.state')" width="110">
          <template #default="{ row }">
            <el-tag :type="row.disabled ? 'danger' : 'success'" size="small">
              {{ row.disabled ? t("common.disabled") : t("common.enabled") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deviceCount" :label="t('admin.devices')" width="90" />
        <el-table-column :label="t('admin.createdAt')" min-width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" min-width="330" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button
                text
                size="small"
                :type="row.disabled ? 'success' : 'danger'"
                :icon="row.disabled ? CircleCheck : CircleClose"
                @click="toggleState(row)"
              >
                {{ row.disabled ? t("admin.enable") : t("admin.disable") }}
              </el-button>
              <el-button text size="small" :icon="Key" @click="toggleRole(row)">
                {{ row.role === "admin" ? t("admin.demote") : t("admin.promote") }}
              </el-button>
              <el-button text size="small" :icon="Refresh" @click="revokeSessions(row)">
                {{ t("admin.revokeSessions") }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && users.length === 0" :description="t('admin.empty')" />
      <p class="total">{{ t("admin.total", { count: total }) }}</p>
    </el-card>
  </section>
</template>

<style scoped>
.admin-page {
  display: grid;
  gap: 18px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 22px;
}

.hint,
.total {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.admin-table-card {
  min-width: 0;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
</style>
