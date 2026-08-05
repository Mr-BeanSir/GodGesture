<script setup lang="ts">
/**
 * 「手势」区:左侧应用列表(全局 + 各应用),右侧手势意图表 + 意图编辑器。
 * 手势录制走 captureStart() + onGestureCaptured();支持增删改意图、绑定 12 类命令。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Delete,
  Edit,
  MoreFilled,
  Plus,
  VideoCamera,
} from "@element-plus/icons-vue";
import type {
  AppEntry,
  AppGroup,
  BoundaryIntent,
  BoundaryOrigin,
  BoundaryToken,
  GestureIntent,
  GestureSpec,
  GestureModifier,
} from "@godgesture/shared";
import { DEFAULT_APP_GROUP_ID } from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import {
  moveAppToGroup,
  moveGroupBefore,
  removeCustomGroup,
} from "../utils/app-groups";
import {
  getDragPreviewOffset,
  groupIdFromDropTarget,
  isActivePointerDrag,
  type PointerDrag,
} from "../utils/group-drag";
import { createDefaultCommand } from "../utils/commands";
import { findBoundaryConflict } from "../utils/boundary-actions";
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
const collapsedGroups = ref<Record<string, boolean>>({});

type DragState = { kind: "app" | "group"; id: string } | null;
type GroupCommand = { action: "rename" | "delete"; groupId: string };
const dragState = ref<DragState>(null);
const dragOverGroupId = ref<string | null>(null);
const pointerDrag = ref<PointerDrag | null>(null);
const pointerDragElement = ref<HTMLElement | null>(null);
const dragSourceElement = ref<HTMLElement | null>(null);
const dragPreviewElement = ref<HTMLElement | null>(null);
const dragPreviewOffset = ref<{ x: number; y: number } | null>(null);

type ActionRow =
  | { kind: "gesture"; key: string; id: string; name: string; intent: GestureIntent }
  | { kind: "boundary"; key: string; id: string; name: string; intent: BoundaryIntent };

const gestureKey = (id: string) => `gesture:${id}`;
const boundaryKey = (id: string) => `boundary:${id}`;

const currentIsGlobal = computed(() => selectedAppId.value === GLOBAL);
const sortedApps = computed(() => [...doc.value.apps].sort((a, b) => a.order - b.order));
const sortedGroups = computed(() => [...doc.value.groups].sort((a, b) => a.order - b.order));
const currentApp = computed<AppEntry | null>(
  () => sortedApps.value.find((a) => a.id === selectedAppId.value) ?? null,
);

function appsInGroup(groupId: string): AppEntry[] {
  return sortedApps.value.filter((app) => app.groupId === groupId);
}

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroups.value[groupId] === true;
}

function toggleGroup(groupId: string) {
  collapsedGroups.value[groupId] = !isGroupCollapsed(groupId);
}

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

function normalizeAppOrders(groupId: string) {
  appsInGroup(groupId).forEach((app, index) => {
    app.order = index;
  });
}

function onAppSave(app: AppEntry) {
  const apps = doc.value.apps;
  const idx = apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) {
    apps[idx] = app;
  } else {
    app.groupId = doc.value.groups.some((group) => group.id === app.groupId)
      ? app.groupId
      : DEFAULT_APP_GROUP_ID;
    app.order = appsInGroup(app.groupId).length;
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
  normalizeAppOrders(app.groupId);
  if (selectedAppId.value === app.id) selectApp(GLOBAL);
}

async function promptGroupName(initialName: string, title: string): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(t("gestures.groupNamePrompt"), title, {
      inputValue: initialName,
      inputPlaceholder: t("gestures.groupNamePlaceholder"),
      inputValidator: (value) => {
        const normalized = value.trim();
        if (!normalized) return t("gestures.groupNameRequired");
        if (normalized.length > 64) return t("gestures.groupNameTooLong");
        return true;
      },
      confirmButtonText: t("common.save"),
      cancelButtonText: t("common.cancel"),
    });
    return result.value.trim();
  } catch {
    return null;
  }
}

async function addGroup() {
  const name = await promptGroupName("", t("gestures.addGroup"));
  if (!name) return;
  const group: AppGroup = {
    id: newId(),
    name,
    order: doc.value.groups.reduce((max, candidate) => Math.max(max, candidate.order), -1) + 1,
  };
  doc.value.groups.push(group);
  collapsedGroups.value[group.id] = false;
}

async function renameGroup(group: AppGroup) {
  const name = await promptGroupName(group.name, t("gestures.renameGroup"));
  if (name && name !== group.name) group.name = name;
}

async function deleteGroup(group: AppGroup) {
  if (group.id === DEFAULT_APP_GROUP_ID) return;
  try {
    await ElMessageBox.confirm(
      t("gestures.deleteGroupConfirm", { name: group.name }),
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
  removeCustomGroup(doc.value.groups, doc.value.apps, group.id);
  delete collapsedGroups.value[group.id];
}

function onGroupCommand(command: GroupCommand) {
  const group = doc.value.groups.find((candidate) => candidate.id === command.groupId);
  if (!group) return;
  if (command.action === "rename") void renameGroup(group);
  else void deleteGroup(group);
}

function isDragging(kind: "app" | "group", id: string): boolean {
  return dragState.value?.kind === kind && dragState.value.id === id;
}

function dragSourceFromEvent(event: PointerEvent): HTMLElement | null {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>(".gestures__app-item, .gestures__group") ?? target;
}

function updateDragPreview(event: PointerEvent) {
  const preview = dragPreviewElement.value;
  const offset = dragPreviewOffset.value;
  if (!preview || !offset) return;
  preview.style.left = `${event.clientX - offset.x}px`;
  preview.style.top = `${event.clientY - offset.y}px`;
}

function createDragPreview(source: HTMLElement, event: PointerEvent) {
  const preview = source.cloneNode(true) as HTMLElement;
  const rect = source.getBoundingClientRect();
  const offset = getDragPreviewOffset(rect, event.clientX, event.clientY);

  preview.classList.add("gestures__drag-preview");
  preview.classList.remove("is-active", "is-dragging", "is-drop-target");
  preview.removeAttribute("data-group-id");
  preview.querySelectorAll(".is-active, .is-dragging, .is-drop-target").forEach((element) => {
    element.classList.remove("is-active", "is-dragging", "is-drop-target");
  });
  preview.setAttribute("aria-hidden", "true");
  preview.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]").forEach((element) => {
    element.setAttribute("tabindex", "-1");
  });
  preview.style.width = `${rect.width}px`;
  preview.style.left = `${rect.left}px`;
  preview.style.top = `${rect.top}px`;
  document.body.appendChild(preview);

  dragPreviewOffset.value = offset;
  dragPreviewElement.value = preview;
  updateDragPreview(event);
}

function startDrag(kind: "app" | "group", id: string, event: PointerEvent) {
  if (event.button !== 0 || pointerDrag.value) return;
  event.preventDefault();
  event.stopPropagation();
  dragState.value = { kind, id };
  dragOverGroupId.value = null;
  dragSourceElement.value = dragSourceFromEvent(event);
  pointerDrag.value = { kind, id, pointerId: event.pointerId };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", clearDrag);
  window.addEventListener("blur", clearDrag);
  const element = event.currentTarget;
  if (element instanceof HTMLElement) {
    pointerDragElement.value = element;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // The window listeners still receive the drag when pointer capture is unavailable.
    }
  }
  if (dragSourceElement.value) createDragPreview(dragSourceElement.value, event);
}

function clearDrag() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", clearDrag);
  window.removeEventListener("blur", clearDrag);
  const currentPointerDrag = pointerDrag.value;
  const element = pointerDragElement.value;
  if (
    currentPointerDrag &&
    element?.hasPointerCapture(currentPointerDrag.pointerId)
  ) {
    element.releasePointerCapture(currentPointerDrag.pointerId);
  }
  pointerDrag.value = null;
  pointerDragElement.value = null;
  dragSourceElement.value = null;
  dragPreviewElement.value?.remove();
  dragPreviewElement.value = null;
  dragPreviewOffset.value = null;
  dragState.value = null;
  dragOverGroupId.value = null;
}

function onPointerMove(event: PointerEvent) {
  if (!isActivePointerDrag(pointerDrag.value, event.pointerId)) return;
  event.preventDefault();
  updateDragPreview(event);
  dragOverGroupId.value = groupIdFromDropTarget(
    document.elementFromPoint(event.clientX, event.clientY),
  );
}

onBeforeUnmount(clearDrag);

function onPointerUp(event: PointerEvent) {
  if (!isActivePointerDrag(pointerDrag.value, event.pointerId)) return;
  event.preventDefault();
  event.stopPropagation();
  updateDragPreview(event);
  const targetGroupId =
    groupIdFromDropTarget(document.elementFromPoint(event.clientX, event.clientY)) ??
    dragOverGroupId.value;
  if (targetGroupId) dropOnGroup(targetGroupId);
  else clearDrag();
}

function dropOnGroup(targetGroupId: string) {
  const current = dragState.value;
  if (!current) {
    clearDrag();
    return;
  }
  if (current.kind === "app") {
    moveAppToGroup(doc.value.apps, doc.value.groups, current.id, targetGroupId);
  } else {
    moveGroupBefore(doc.value.groups, current.id, targetGroupId);
  }
  clearDrag();
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
const capturePreservedModifier = computed<GestureModifier>(() => {
  if (!reRecordId.value) return "none";
  return intentsArray().find((intent) => intent.id === reRecordId.value)?.gesture.modifier ?? "none";
});

onMounted(() => selectApp(GLOBAL));
</script>

<template>
  <div class="gestures">
    <!-- 应用列表 -->
    <aside class="gestures__apps">
      <div class="gestures__apps-head">
        <span>{{ t("gestures.appListTitle") }}</span>
        <span class="gestures__apps-head-actions">
          <el-button link size="small" :icon="Plus" @click="addGroup">{{ t("gestures.addGroup") }}</el-button>
          <el-button size="small" :icon="Plus" @click="openAddApp">{{ t("gestures.addApp") }}</el-button>
        </span>
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
          v-for="group in sortedGroups"
          :key="group.id"
          class="gestures__group"
          :data-group-id="group.id"
          :class="{
            'is-drop-target': dragOverGroupId === group.id,
            'is-dragging': isDragging('group', group.id),
          }"
        >
          <div class="gestures__group-head">
            <button
              class="gestures__drag-grip gestures__group-grip"
              type="button"
              :aria-label="t('gestures.dragGroup', { name: group.name })"
              @click.stop
              @pointerdown="startDrag('group', group.id, $event)"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="10" cy="2" r="1" />
                <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" /><circle cx="10" cy="6" r="1" />
                <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" /><circle cx="10" cy="10" r="1" />
              </svg>
            </button>
            <button
              class="gestures__group-toggle"
              type="button"
              :aria-expanded="!isGroupCollapsed(group.id)"
              @click="toggleGroup(group.id)"
            >
              <span class="gestures__group-chevron" :class="{ 'is-collapsed': isGroupCollapsed(group.id) }">▾</span>
              <span class="gestures__group-name">{{ group.name }}</span>
              <span class="gestures__group-count">{{ appsInGroup(group.id).length }}</span>
            </button>
            <el-dropdown trigger="click" @command="onGroupCommand">
              <button
                class="gestures__group-menu"
                type="button"
                :aria-label="t('gestures.groupMenu', { name: group.name })"
                @click.stop
              >
                <el-icon><MoreFilled /></el-icon>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="{ action: 'rename', groupId: group.id }">
                    {{ t("gestures.renameGroup") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    :command="{ action: 'delete', groupId: group.id }"
                    :disabled="group.id === DEFAULT_APP_GROUP_ID"
                  >
                    {{ t("gestures.deleteGroup") }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <ul v-if="!isGroupCollapsed(group.id)" class="gestures__group-apps">
            <li
              v-for="app in appsInGroup(group.id)"
              :key="app.id"
              class="gestures__app-item"
              :class="{
                'is-active': app.id === selectedAppId,
                'is-dragging': isDragging('app', app.id),
              }"
              @click="selectApp(app.id)"
            >
              <button
                class="gestures__drag-grip gestures__app-grip"
                type="button"
                :aria-label="t('gestures.dragApp', { name: app.name })"
                @click.stop
                @pointerdown="startDrag('app', app.id, $event)"
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="10" cy="2" r="1" />
                  <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" /><circle cx="10" cy="6" r="1" />
                  <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" /><circle cx="10" cy="10" r="1" />
                </svg>
              </button>
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
        </li>
      </ul>
    </aside>

    <!-- 意图区 -->
    <section class="gestures__main">
      <header class="gestures__main-head">
        <h3 class="gestures__title">{{ currentTitle }}</h3>
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
      :preserve-modifier="capturePreservedModifier"
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
  background: var(--gg-surface);
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
.gestures__apps-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.gestures__app-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  min-height: 0;
  overflow-y: auto;
}
.gestures__group {
  list-style: none;
  margin: 0;
  border-radius: var(--el-border-radius-base);
  transition: background-color 120ms ease;
}
.gestures__group.is-drop-target {
  background: var(--el-color-primary-light-9);
}
.gestures__group.is-dragging,
.gestures__app-item.is-dragging {
  outline: 1px dashed var(--el-color-primary);
  outline-offset: -1px;
  background: var(--el-fill-color-light);
  opacity: 0.58;
}
.gestures__drag-preview {
  position: fixed;
  z-index: 3000;
  box-sizing: border-box;
  pointer-events: none;
  opacity: 0.92;
  box-shadow: var(--el-box-shadow-light);
}
.gestures__group-head {
  display: flex;
  align-items: center;
  min-height: 34px;
  gap: 2px;
  padding: 2px 3px 2px 1px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.gestures__group-toggle {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 5px;
  padding: 4px 3px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.gestures__group-toggle:hover { color: var(--el-text-color-primary); }
.gestures__group-chevron {
  width: 12px;
  flex: 0 0 auto;
  color: var(--el-text-color-placeholder);
  transform: rotate(0deg);
  transition: transform 120ms ease;
}
.gestures__group-chevron.is-collapsed { transform: rotate(-90deg); }
.gestures__group-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.gestures__group-count {
  flex: 0 0 auto;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.gestures__group-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
}
.gestures__group-menu:hover,
.gestures__group-menu:focus-visible {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.gestures__group-apps {
  list-style: none;
  margin: 0;
  padding: 0 0 3px 8px;
}
.gestures__app-item {
  display: flex;
  align-items: center;
  gap: 5px;
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
  flex: 1;
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
.gestures__app-item:hover .gestures__app-actions,
.gestures__app-item:focus-within .gestures__app-actions {
  display: inline-flex;
}
.gestures__drag-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-placeholder);
  cursor: grab;
  opacity: 0;
  touch-action: none;
  user-select: none;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}
.gestures__drag-grip:active { cursor: grabbing; }
.gestures__drag-grip svg { width: 12px; height: 12px; fill: currentColor; }
.gestures__group-head:hover .gestures__group-grip,
.gestures__group-head:focus-within .gestures__group-grip,
.gestures__app-item:hover .gestures__app-grip,
.gestures__app-item:focus-within .gestures__app-grip,
.gestures__drag-grip:focus-visible {
  opacity: 1;
}
.gestures__drag-grip:hover,
.gestures__drag-grip:focus-visible {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  outline: none;
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
