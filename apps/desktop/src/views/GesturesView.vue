<script setup lang="ts">
/**
 * 「手势」区:左侧应用列表(全局 + 各应用),右侧手势意图表 + 意图编辑器。
 * 手势录制走 captureStart() + onGestureCaptured();支持增删改意图、绑定 12 类命令。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessageBox } from "element-plus";
import { Plus, Edit, Delete, VideoCamera } from "@element-plus/icons-vue";
import type { AppEntry, GestureIntent, GestureSpec } from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import { createDefaultCommand } from "../utils/commands";
import MnemonicText from "../components/MnemonicText.vue";
import IntentEditor from "../components/IntentEditor.vue";
import CaptureDialog from "../components/CaptureDialog.vue";
import AppDialog from "../components/AppDialog.vue";
import AppIcon from "../components/AppIcon.vue";

const GLOBAL = "__global__";

const { t } = useI18n();
const store = useConfigStore();
const doc = computed(() => store.doc!);

const selectedAppId = ref<string>(GLOBAL);
const selectedIntentId = ref<string | null>(null);

const captureVisible = ref(false);
const reRecordId = ref<string | null>(null);
const appDialogVisible = ref(false);
const editingApp = ref<AppEntry | null>(null);

const currentIsGlobal = computed(() => selectedAppId.value === GLOBAL);
const sortedApps = computed(() => [...doc.value.apps].sort((a, b) => a.order - b.order));
const currentApp = computed<AppEntry | null>(
  () => sortedApps.value.find((a) => a.id === selectedAppId.value) ?? null,
);

function intentsArray(): GestureIntent[] {
  return currentIsGlobal.value ? doc.value.global.intents : (currentApp.value?.intents ?? []);
}

const sortedIntents = computed(() => [...intentsArray()].sort((a, b) => a.order - b.order));
const selectedIntent = computed<GestureIntent | null>(
  () => intentsArray().find((i) => i.id === selectedIntentId.value) ?? null,
);

const currentTitle = computed(() =>
  currentIsGlobal.value ? t("gestures.globalApp") : (currentApp.value?.name ?? ""),
);

const blacklisted = computed<boolean>({
  get: () =>
    currentIsGlobal.value
      ? !doc.value.global.gesturingEnabled
      : !(currentApp.value?.gesturingEnabled ?? true),
  set: (v) => {
    if (currentIsGlobal.value) doc.value.global.gesturingEnabled = !v;
    else if (currentApp.value) currentApp.value.gesturingEnabled = !v;
  },
});

function selectApp(id: string) {
  selectedAppId.value = id;
  selectedIntentId.value = sortedIntents.value[0]?.id ?? null;
}

function selectIntent(id: string) {
  selectedIntentId.value = id;
}

function rowClass({ row }: { row: GestureIntent }) {
  return row.id === selectedIntentId.value ? "is-selected" : "";
}

// ---- 应用增删改 ----
function openAddApp() {
  editingApp.value = null;
  appDialogVisible.value = true;
}
function openEditApp(app: AppEntry) {
  editingApp.value = app;
  appDialogVisible.value = true;
}
function onAppSave(app: AppEntry) {
  const apps = doc.value.apps;
  const idx = apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) {
    apps[idx] = app;
  } else {
    app.order = apps.length;
    apps.push(app);
  }
  selectApp(app.id);
}
async function deleteApp(app: AppEntry) {
  try {
    await ElMessageBox.confirm(
      t("gestures.deleteAppConfirm", { name: app.name }),
      t("common.confirmDeleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  const apps = doc.value.apps;
  const idx = apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) apps.splice(idx, 1);
  if (selectedAppId.value === app.id) selectApp(GLOBAL);
}

// ---- 意图录制 / 增删 ----
function openRecordNew() {
  reRecordId.value = null;
  captureVisible.value = true;
}
function openReRecord() {
  if (!selectedIntent.value) return;
  reRecordId.value = selectedIntent.value.id;
  captureVisible.value = true;
}
function reRecordRow(id: string) {
  selectIntent(id);
  openReRecord();
}

function onCaptureConfirm({ gesture, overwriteId }: { gesture: GestureSpec; overwriteId: string | null }) {
  const arr = intentsArray();
  if (reRecordId.value) {
    const cur = arr.find((i) => i.id === reRecordId.value);
    if (cur) cur.gesture = gesture;
    if (overwriteId && overwriteId !== reRecordId.value) {
      const idx = arr.findIndex((i) => i.id === overwriteId);
      if (idx >= 0) arr.splice(idx, 1);
    }
    selectedIntentId.value = reRecordId.value;
  } else {
    if (overwriteId) {
      const idx = arr.findIndex((i) => i.id === overwriteId);
      if (idx >= 0) arr.splice(idx, 1);
    }
    const order = arr.reduce((m, i) => Math.max(m, i.order), -1) + 1;
    const created: GestureIntent = {
      id: newId(),
      name: t("gestures.newIntentName"),
      gesture,
      command: createDefaultCommand("doNothing"),
      executeOnModifier: false,
      order,
    };
    arr.push(created);
    selectedIntentId.value = created.id;
  }
  reRecordId.value = null;
}

async function deleteIntent(intent: GestureIntent) {
  try {
    await ElMessageBox.confirm(
      t("gestures.deleteIntentConfirm", { name: intent.name }),
      t("common.confirmDeleteTitle"),
      {
        type: "warning",
        confirmButtonText: t("common.delete"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  const arr = intentsArray();
  const idx = arr.findIndex((i) => i.id === intent.id);
  if (idx >= 0) arr.splice(idx, 1);
  if (selectedIntentId.value === intent.id) {
    selectedIntentId.value = sortedIntents.value[0]?.id ?? null;
  }
}

/** 冲突检测用:排除重录目标自身 */
const captureExisting = computed(() => intentsArray());
const captureExcludeId = computed(() => reRecordId.value ?? undefined);

onMounted(() => selectApp(GLOBAL));
</script>

<template>
  <div class="gestures">
    <!-- 应用列表 -->
    <aside class="gestures__apps">
      <div class="gestures__apps-head">
        <span>{{ t("gestures.appListTitle") }}</span>
        <el-button size="small" :icon="Plus" @click="openAddApp">{{ t("gestures.addApp") }}</el-button>
      </div>
      <ul class="gestures__app-list">
        <li
          class="gestures__app-item"
          :class="{ 'is-active': currentIsGlobal }"
          @click="selectApp(GLOBAL)"
        >
          <span class="gestures__app-identity">
            <AppIcon :label="t('gestures.globalApp')" global />
            <span class="gestures__app-name">{{ t("gestures.globalApp") }}</span>
          </span>
        </li>
        <li
          v-for="app in sortedApps"
          :key="app.id"
          class="gestures__app-item"
          :class="{ 'is-active': app.id === selectedAppId }"
          @click="selectApp(app.id)"
        >
          <span class="gestures__app-identity">
            <AppIcon
              :label="app.name"
              :windows-exe-name="app.windows?.exeName"
              :mac-bundle-id="app.mac?.bundleId"
            />
            <span class="gestures__app-name">{{ app.name }}</span>
          </span>
          <span class="gestures__app-actions">
            <el-button link size="small" :icon="Edit" @click.stop="openEditApp(app)" />
            <el-button link size="small" :icon="Delete" @click.stop="deleteApp(app)" />
          </span>
        </li>
      </ul>
    </aside>

    <!-- 意图区 -->
    <section class="gestures__main">
      <header class="gestures__main-head">
        <h3 class="gestures__title">{{ currentTitle }}</h3>
        <div class="gestures__toggles">
          <template v-if="!currentIsGlobal && currentApp">
            <div class="gg-switch-row">
              <el-switch v-model="currentApp.inheritGlobalGestures" />
              <span>{{ t("gestures.inheritGlobal") }}</span>
            </div>
          </template>
          <div class="gg-switch-row">
            <el-switch v-model="blacklisted" />
            <span>{{ currentIsGlobal ? t("gestures.blacklistGlobal") : t("gestures.blacklist") }}</span>
          </div>
        </div>
      </header>

      <div v-if="!currentIsGlobal && currentApp" class="gestures__dormant">
        <el-tag v-if="!currentApp.windows" type="info" size="small">{{ t("gestures.dormantWindows") }}</el-tag>
        <el-tag v-if="!currentApp.mac" type="info" size="small">{{ t("gestures.dormantMac") }}</el-tag>
      </div>

      <div class="gestures__workspace">
        <section class="gestures__table-pane">
          <div class="gestures__toolbar">
            <span class="gestures__count">{{ sortedIntents.length }}</span>
            <el-button type="primary" size="small" :icon="VideoCamera" @click="openRecordNew">
              {{ t("gestures.addIntent") }}
            </el-button>
          </div>
          <div class="gestures__table-body">
            <el-table
              v-if="sortedIntents.length"
              :data="sortedIntents"
              :row-class-name="rowClass"
              height="100%"
              size="small"
              class="gestures__table"
              @row-click="(row: GestureIntent) => selectIntent(row.id)"
            >
              <el-table-column
                :label="t('gestures.colName')"
                prop="name"
                min-width="100"
                show-overflow-tooltip
              />
              <el-table-column :label="t('gestures.colMnemonic')" min-width="88">
                <template #default="{ row }">
                  <MnemonicText :gesture="row.gesture" />
                </template>
              </el-table-column>
              <el-table-column
                :label="t('gestures.colCommand')"
                min-width="96"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{ t(`command.types.${row.command.type}`) }}
                </template>
              </el-table-column>
              <el-table-column width="72" align="right">
                <template #default="{ row }">
                  <el-button link size="small" :icon="VideoCamera" @click.stop="reRecordRow(row.id)" />
                  <el-button link size="small" :icon="Delete" @click.stop="deleteIntent(row)" />
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else :description="t('gestures.emptyIntents')" :image-size="64" />
          </div>
        </section>

        <section class="gestures__editor-pane">
          <IntentEditor
            v-if="selectedIntent"
            :key="selectedIntent.id"
            :intent="selectedIntent"
            @re-record="openReRecord"
          />
          <p v-else class="gg-hint">{{ t("gestures.noSelection") }}</p>
        </section>
      </div>
    </section>

    <CaptureDialog
      v-model="captureVisible"
      :existing-intents="captureExisting"
      :exclude-id="captureExcludeId"
      @confirm="onCaptureConfirm"
    />
    <AppDialog v-model="appDialogVisible" :app="editingApp" @save="onAppSave" />
  </div>
</template>

<style scoped>
.gestures {
  display: grid;
  grid-template-columns: clamp(184px, 22vw, 224px) minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gestures__apps {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.gestures__apps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.gestures__app-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  min-height: 0;
  overflow-y: auto;
}
.gestures__app-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 4px 7px;
  border-radius: var(--el-border-radius-base);
  cursor: pointer;
  font-size: 14px;
}
.gestures__app-identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}
.gestures__app-item:hover {
  background: var(--el-fill-color-light);
}
.gestures__app-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.gestures__app-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gestures__app-actions {
  display: none;
  flex-shrink: 0;
}
.gestures__app-item:hover .gestures__app-actions {
  display: inline-flex;
}
.gestures__main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.gestures__main-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.gestures__title {
  margin: 0;
  font-size: 16px;
  line-height: 28px;
}
.gestures__toggles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gestures__dormant {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.gestures__workspace {
  display: grid;
  grid-template-rows: minmax(150px, 1.1fr) minmax(190px, 0.9fr);
  min-height: 0;
  margin-top: 10px;
  gap: 10px;
}
.gestures__table-pane,
.gestures__editor-pane {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  overflow: hidden;
}
.gestures__table-pane {
  display: grid;
  grid-template-rows: 40px minmax(0, 1fr);
}
.gestures__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.gestures__count {
  min-width: 24px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.gestures__table-body {
  min-height: 0;
}
.gestures__table {
  width: 100%;
}
.gestures__table :deep(.is-selected) {
  background: var(--el-color-primary-light-9);
}
.gestures__table :deep(tr) {
  cursor: pointer;
}
.gestures__editor-pane {
  padding: 12px 14px;
  overflow-y: auto;
}
@media (max-width: 860px) {
  .gestures {
    grid-template-columns: 184px minmax(0, 1fr);
    gap: 10px;
  }
  .gestures__main-head {
    gap: 8px;
  }
  .gestures__toggles {
    font-size: 12px;
  }
}
</style>
