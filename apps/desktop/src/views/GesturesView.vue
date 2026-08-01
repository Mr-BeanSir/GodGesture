<script setup lang="ts">
/**
 * 「手势」区:左侧应用列表(全局 + 各应用),右侧手势意图表 + 意图编辑器。
 * 手势录制走 captureStart() + onGestureCaptured();支持增删改意图、绑定 12 类命令。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Delete,
  Edit,
  Plus,
  VideoCamera,
} from "@element-plus/icons-vue";
import type {
  AppEntry,
  BoundaryIntent,
  BoundaryOrigin,
  BoundaryToken,
  GestureIntent,
  GestureSpec,
} from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import { createDefaultCommand } from "../utils/commands";
import { findBoundaryConflict } from "../utils/boundary-actions";
import {
  countLegacyScriptCommands,
  migrateLegacyScriptsInDocument,
} from "../utils/nodePluginMigration";
import MnemonicText from "../components/MnemonicText.vue";
import IntentEditor from "../components/IntentEditor.vue";
import CaptureDialog from "../components/CaptureDialog.vue";
import AppDialog from "../components/AppDialog.vue";
import AppIcon from "../components/AppIcon.vue";
import AddActionDialog from "../components/AddActionDialog.vue";
import BoundaryIntentEditor from "../components/BoundaryIntentEditor.vue";
import BoundaryMnemonic from "../components/BoundaryMnemonic.vue";

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
const addActionVisible = ref(false);
const editingBoundaryId = ref<string | null>(null);

type ActionRow =
  | { kind: "gesture"; key: string; id: string; name: string; intent: GestureIntent }
  | { kind: "boundary"; key: string; id: string; name: string; intent: BoundaryIntent };

const gestureKey = (id: string) => `gesture:${id}`;
const boundaryKey = (id: string) => `boundary:${id}`;

const currentIsGlobal = computed(() => selectedAppId.value === GLOBAL);
const sortedApps = computed(() => [...doc.value.apps].sort((a, b) => a.order - b.order));
const currentApp = computed<AppEntry | null>(
  () => sortedApps.value.find((a) => a.id === selectedAppId.value) ?? null,
);

function intentsArray(): GestureIntent[] {
  return currentIsGlobal.value ? doc.value.global.intents : (currentApp.value?.intents ?? []);
}

const sortedIntents = computed(() => [...intentsArray()].sort((a, b) => a.order - b.order));
const sortedActions = computed<ActionRow[]>(() => {
  const gestures: ActionRow[] = sortedIntents.value.map((intent) => ({
    kind: "gesture",
    key: gestureKey(intent.id),
    id: intent.id,
    name: intent.name,
    intent,
  }));
  if (!currentIsGlobal.value) return gestures;
  const boundaries: ActionRow[] = [...doc.value.boundaryIntents]
    .sort((a, b) => a.order - b.order)
    .map((intent) => ({
      kind: "boundary",
      key: boundaryKey(intent.id),
      id: intent.id,
      name: intent.name,
      intent,
    }));
  return [...gestures, ...boundaries];
});
const selectedIntent = computed<GestureIntent | null>(
  () => {
    const id = selectedIntentId.value?.startsWith("gesture:")
      ? selectedIntentId.value.slice("gesture:".length)
      : null;
    return id ? (intentsArray().find((intent) => intent.id === id) ?? null) : null;
  },
);
const selectedBoundary = computed<BoundaryIntent | null>(() => {
  const id = selectedIntentId.value?.startsWith("boundary:")
    ? selectedIntentId.value.slice("boundary:".length)
    : null;
  return id ? (doc.value.boundaryIntents.find((intent) => intent.id === id) ?? null) : null;
});
const editingBoundary = computed<BoundaryIntent | null>(() =>
  editingBoundaryId.value
    ? (doc.value.boundaryIntents.find((intent) => intent.id === editingBoundaryId.value) ?? null)
    : null,
);

const currentTitle = computed(() =>
  currentIsGlobal.value ? t("gestures.globalApp") : (currentApp.value?.name ?? ""),
);
const legacyScriptCount = computed(() => countLegacyScriptCommands(doc.value));

async function migrateLegacyScripts() {
  try {
    await ElMessageBox.confirm(
      t("gestures.scriptMigration.confirm", { count: legacyScriptCount.value }),
      t("gestures.scriptMigration.title"),
      {
        type: "warning",
        confirmButtonText: t("gestures.scriptMigration.action"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  const report = migrateLegacyScriptsInDocument(doc.value, (name) =>
    t("gestures.scriptMigration.pluginName", { name }),
  );
  if (report.converted) {
    ElMessage.success(t("gestures.scriptMigration.complete", { converted: report.converted }));
  }
  if (report.luaSkipped || report.capacitySkipped || report.sizeSkipped) {
    ElMessage.warning(t("gestures.scriptMigration.skipped", {
      luaSkipped: report.luaSkipped,
      capacitySkipped: report.capacitySkipped,
      sizeSkipped: report.sizeSkipped,
    }));
  }
}

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
  selectedIntentId.value = sortedActions.value[0]?.key ?? null;
}

function selectIntent(id: string) {
  selectedIntentId.value = id;
}

function rowClass({ row }: { row: ActionRow }) {
  return [
    row.key === selectedIntentId.value ? "is-selected" : "",
    row.intent.enabled ? "" : "is-disabled",
  ]
    .filter(Boolean)
    .join(" ");
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

// ---- 动作录制 / 增删 ----
function openRecordNew() {
  editingBoundaryId.value = null;
  addActionVisible.value = true;
}
function beginGestureRecord() {
  reRecordId.value = null;
  captureVisible.value = true;
}
function openReRecord() {
  if (selectedIntent.value) {
    reRecordId.value = selectedIntent.value.id;
    captureVisible.value = true;
  } else if (selectedBoundary.value) {
    editingBoundaryId.value = selectedBoundary.value.id;
    addActionVisible.value = true;
  }
}
function toggleAction(row: ActionRow) {
  row.intent.enabled = !row.intent.enabled;
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
    selectedIntentId.value = gestureKey(reRecordId.value);
  } else {
    if (overwriteId) {
      const idx = arr.findIndex((i) => i.id === overwriteId);
      if (idx >= 0) arr.splice(idx, 1);
    }
    const order = arr.reduce((m, i) => Math.max(m, i.order), -1) + 1;
    const created: GestureIntent = {
      id: newId(),
      name: t("gestures.newIntentName"),
      enabled: true,
      gesture,
      command: createDefaultCommand("doNothing"),
      executeOnModifier: false,
      order,
    };
    arr.push(created);
    selectedIntentId.value = gestureKey(created.id);
  }
  reRecordId.value = null;
}

async function onBoundaryConfirm(value: { origin: BoundaryOrigin; sequence: BoundaryToken[] }) {
  const conflict = findBoundaryConflict(
    doc.value.boundaryIntents,
    value.origin,
    value.sequence,
    editingBoundaryId.value,
  );
  if (conflict?.kind === "exact") {
    try {
      await ElMessageBox.confirm(
        t("actions.overwriteMessage", { name: conflict.intent.name }),
        t("actions.overwriteTitle"),
        {
          type: "warning",
          confirmButtonText: t("capture.overwrite"),
          cancelButtonText: t("common.cancel"),
        },
      );
    } catch {
      return;
    }
    const index = doc.value.boundaryIntents.findIndex(
      (intent) => intent.id === conflict.intent.id,
    );
    if (index >= 0) doc.value.boundaryIntents.splice(index, 1);
  } else if (conflict) {
    ElMessage.warning(t("actions.prefixConflict", { name: conflict.intent.name }));
    return;
  }

  if (editingBoundaryId.value) {
    const intent = doc.value.boundaryIntents.find(
      (candidate) => candidate.id === editingBoundaryId.value,
    );
    if (intent) {
      intent.origin = value.origin;
      intent.sequence = value.sequence;
      selectedIntentId.value = boundaryKey(intent.id);
    }
  } else {
    const intent: BoundaryIntent = {
      id: newId(),
      name: t("actions.newBoundaryName"),
      enabled: true,
      origin: value.origin,
      sequence: value.sequence,
      command: createDefaultCommand("doNothing"),
      order: doc.value.boundaryIntents.reduce((max, item) => Math.max(max, item.order), -1) + 1,
    };
    doc.value.boundaryIntents.push(intent);
    selectedIntentId.value = boundaryKey(intent.id);
  }
  editingBoundaryId.value = null;
  addActionVisible.value = false;
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
  if (selectedIntentId.value === gestureKey(intent.id)) {
    selectedIntentId.value = sortedActions.value[0]?.key ?? null;
  }
}

async function deleteAction(row: ActionRow) {
  if (row.kind === "gesture") {
    await deleteIntent(row.intent);
    return;
  }
  try {
    await ElMessageBox.confirm(
      t("gestures.deleteIntentConfirm", { name: row.name }),
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
  const index = doc.value.boundaryIntents.findIndex((intent) => intent.id === row.id);
  if (index >= 0) doc.value.boundaryIntents.splice(index, 1);
  if (selectedIntentId.value === row.key) {
    selectedIntentId.value = sortedActions.value[0]?.key ?? null;
  }
}

async function deleteSelectedAction() {
  const row = sortedActions.value.find((candidate) => candidate.key === selectedIntentId.value);
  if (row) await deleteAction(row);
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
        <el-button
          v-if="legacyScriptCount"
          size="small"
          type="warning"
          plain
          @click="migrateLegacyScripts"
        >
          {{ t("gestures.scriptMigration.actionWithCount", { count: legacyScriptCount }) }}
        </el-button>
        <div class="gestures__settings-strip">
          <template v-if="!currentIsGlobal && currentApp">
            <label class="gestures__setting">
              <span>{{ t("gestures.inheritGlobal") }}</span>
              <el-switch v-model="currentApp.inheritGlobalGestures" />
            </label>
          </template>
          <template v-else>
            <label class="gestures__setting">
              <span>{{ t("actions.enableHotCorners") }}</span>
              <el-switch v-model="doc.hotCorners.enabled" />
            </label>
            <label class="gestures__setting">
              <span>{{ t("actions.enableRubEdges") }}</span>
              <el-switch v-model="doc.rubEdges.enabled" />
            </label>
          </template>
          <label class="gestures__setting gestures__setting--danger">
            <span>{{ currentIsGlobal ? t("gestures.blacklistGlobalShort") : t("gestures.blacklistShort") }}</span>
            <el-switch v-model="blacklisted" />
          </label>
        </div>
      </header>

      <div v-if="!currentIsGlobal && currentApp" class="gestures__dormant">
        <el-tag v-if="!currentApp.windows" type="info" size="small">{{ t("gestures.dormantWindows") }}</el-tag>
        <el-tag v-if="!currentApp.mac" type="info" size="small">{{ t("gestures.dormantMac") }}</el-tag>
      </div>

      <div class="gestures__workspace">
        <section class="gestures__table-pane">
          <div class="gestures__toolbar">
            <span class="gestures__count">{{ sortedActions.length }}</span>
            <el-button type="primary" size="small" :icon="VideoCamera" @click="openRecordNew">
              {{ t("gestures.addIntent") }}
            </el-button>
          </div>
          <div class="gestures__table-body">
            <el-table
              v-if="sortedActions.length"
              :data="sortedActions"
              :row-class-name="rowClass"
              height="100%"
              size="small"
              class="gestures__table"
              @row-click="(row: ActionRow) => selectIntent(row.key)"
            >
              <el-table-column :label="t('gestures.colKind')" width="76">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.kind === 'boundary' ? 'warning' : 'info'">
                    {{ t(row.kind === "boundary" ? "gestures.boundaryKind" : "gestures.gestureKind") }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column
                :label="t('gestures.colName')"
                prop="name"
                min-width="100"
                show-overflow-tooltip
              />
              <el-table-column :label="t('gestures.colMnemonic')" min-width="88">
                <template #default="{ row }">
                  <MnemonicText v-if="row.kind === 'gesture'" :gesture="row.intent.gesture" />
                  <BoundaryMnemonic v-else :intent="row.intent" />
                </template>
              </el-table-column>
              <el-table-column
                :label="t('gestures.colCommand')"
                min-width="96"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  {{ t(`command.types.${row.intent.command.type}`) }}
                </template>
              </el-table-column>
              <el-table-column width="42" align="right">
                <template #default="{ row }">
                  <el-tooltip :content="t(row.intent.enabled ? 'gestures.disableAction' : 'gestures.enableAction')">
                    <el-button
                      link
                      class="gestures__icon-action"
                      :class="{ 'is-enabled': row.intent.enabled }"
                      :icon="row.intent.enabled ? CircleCheckFilled : CircleCloseFilled"
                      :aria-label="t(row.intent.enabled ? 'gestures.disableAction' : 'gestures.enableAction')"
                      @click.stop="toggleAction(row)"
                    />
                  </el-tooltip>
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
            @delete="deleteSelectedAction"
          />
          <BoundaryIntentEditor
            v-else-if="selectedBoundary"
            :key="selectedBoundary.id"
            :intent="selectedBoundary"
            @re-record="openReRecord"
            @delete="deleteSelectedAction"
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
    <AddActionDialog
      v-model="addActionVisible"
      :initial-boundary="editingBoundary"
      @record-gesture="beginGestureRecord"
      @confirm-boundary="onBoundaryConfirm"
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
  background: #ffffff;
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
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.gestures__title {
  margin: 0;
  font-size: 16px;
  line-height: 28px;
}
.gestures__settings-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 5px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-extra-light);
}
.gestures__setting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  white-space: nowrap;
}
.gestures__setting--danger {
  color: var(--el-color-danger);
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
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 40px minmax(0, 1fr);
}
.gestures__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
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
.gestures__table :deep(.el-table__row.is-disabled) {
  color: var(--el-text-color-secondary);
}
.gestures__icon-action {
  width: 26px;
  height: 26px;
  margin-left: 0 !important;
  color: var(--el-text-color-placeholder);
}
.gestures__icon-action.is-enabled {
  color: var(--el-color-success);
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
  .gestures__settings-strip {
    font-size: 12px;
  }
}
</style>
