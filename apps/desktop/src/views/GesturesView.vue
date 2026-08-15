<script setup lang="ts">
/**
 * 「手势」区:左侧应用列表(全局 + 各应用),右侧手势意图表 + 意图编辑器。
 * 手势录制走 captureStart() + onGestureCaptured();支持增删改意图、绑定 12 类命令。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  Download,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Video,
} from "lucide-vue-next";
import {
  AppBadge,
  AppButton,
  AppDialog as SharedAppDialog,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
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
import IntentEditor from "../components/IntentEditor.vue";
import CaptureDialog from "../components/CaptureDialog.vue";
import AppEntryDialog from "../components/AppDialog.vue";
import AppIcon from "../components/AppIcon.vue";
import AddActionDialog from "../components/AddActionDialog.vue";
import BoundaryIntentEditor from "../components/BoundaryIntentEditor.vue";
import GestureExportDialog from "../components/GestureExportDialog.vue";
import GestureActionTable, { type GestureActionTableRow } from "../components/GestureActionTable.vue";

const GLOBAL = "__global__";

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const store = useConfigStore();
const doc = computed(() => store.doc!);

const selectedAppId = ref<string>(GLOBAL);
const selectedIntentId = ref<string | null>(null);

const captureVisible = ref(false);
const reRecordId = ref<string | null>(null);
const appDialogVisible = ref(false);
const editingApp = ref<AppEntry | null>(null);
const addActionVisible = ref(false);
const exportVisible = ref(false);
const editingBoundaryId = ref<string | null>(null);
const collapsedGroups = ref<Record<string, boolean>>({});

type DragState = { kind: "app" | "group"; id: string } | null;
const dragState = ref<DragState>(null);
const dragOverGroupId = ref<string | null>(null);
const pointerDrag = ref<PointerDrag | null>(null);
const pointerDragElement = ref<HTMLElement | null>(null);
const pointerDragStart = ref<{ x: number; y: number } | null>(null);
const pointerDragMoved = ref(false);
const suppressNextGroupGripClick = ref(false);
const dragSourceElement = ref<HTMLElement | null>(null);
const dragPreviewElement = ref<HTMLElement | null>(null);
const dragPreviewOffset = ref<{ x: number; y: number } | null>(null);
const openGroupMenuId = ref<string | null>(null);
const groupNameDialogOpen = ref(false);
const groupNameTitle = ref("");
const groupNameValue = ref("");
const groupNameError = ref("");
const groupNameTarget = ref<AppGroup | null>(null);

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
const actionTableRows = computed<GestureActionTableRow[]>(() =>
  sortedActions.value.map((row) =>
    row.kind === "gesture"
      ? {
          kind: row.kind,
          key: row.key,
          name: row.name,
          gesture: row.intent.gesture,
          commandType: row.intent.command.type,
          enabled: row.intent.enabled,
        }
      : {
          kind: row.kind,
          key: row.key,
          name: row.name,
          boundary: row.intent,
          commandType: row.intent.command.type,
          enabled: row.intent.enabled,
        },
  ),
);
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
  const confirmed = await confirm({
    title: t("common.confirmDeleteTitle"),
    message: t("gestures.deleteAppConfirm", { name: app.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
  });
  if (!confirmed) return;
  const apps = doc.value.apps;
  const idx = apps.findIndex((a) => a.id === app.id);
  if (idx >= 0) apps.splice(idx, 1);
  normalizeAppOrders(app.groupId);
  if (selectedAppId.value === app.id) selectApp(GLOBAL);
}

function openGroupNameDialog(group: AppGroup | null) {
  groupNameTarget.value = group;
  groupNameTitle.value = group ? t("gestures.renameGroup") : t("gestures.addGroup");
  groupNameValue.value = group?.name ?? "";
  groupNameError.value = "";
  groupNameDialogOpen.value = true;
}

function submitGroupName() {
  const name = groupNameValue.value.trim();
  if (!name) {
    groupNameError.value = t("gestures.groupNameRequired");
    return;
  }
  if (name.length > 64) {
    groupNameError.value = t("gestures.groupNameTooLong");
    return;
  }
  const target = groupNameTarget.value;
  if (target) {
    if (name !== target.name) target.name = name;
  } else {
    const group: AppGroup = {
      id: newId(),
      name,
      order: doc.value.groups.reduce((max, candidate) => Math.max(max, candidate.order), -1) + 1,
    };
    doc.value.groups.push(group);
    collapsedGroups.value[group.id] = false;
  }
  groupNameDialogOpen.value = false;
}

function addGroup() {
  openGroupNameDialog(null);
}

function renameGroup(group: AppGroup) {
  openGroupMenuId.value = null;
  openGroupNameDialog(group);
}

async function deleteGroup(group: AppGroup) {
  if (group.id === DEFAULT_APP_GROUP_ID) return;
  openGroupMenuId.value = null;
  const confirmed = await confirm({
    title: t("common.confirmDeleteTitle"),
    message: t("gestures.deleteGroupConfirm", { name: group.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
  });
  if (!confirmed) return;
  removeCustomGroup(doc.value.groups, doc.value.apps, group.id);
  delete collapsedGroups.value[group.id];
}

function toggleGroupMenu(groupId: string) {
  openGroupMenuId.value = openGroupMenuId.value === groupId ? null : groupId;
}

function closeGroupMenuOnPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest(".gestures__group-menu-wrap")) {
    openGroupMenuId.value = null;
  }
  if (!(target instanceof Element) || !target.closest(".gestures__group-grip")) {
    suppressNextGroupGripClick.value = false;
  }
}

function closeGroupMenuOnKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") openGroupMenuId.value = null;
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
  suppressNextGroupGripClick.value = false;
  dragState.value = { kind, id };
  dragOverGroupId.value = null;
  dragSourceElement.value = dragSourceFromEvent(event);
  pointerDragStart.value = { x: event.clientX, y: event.clientY };
  pointerDragMoved.value = false;
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
  pointerDragStart.value = null;
  pointerDragMoved.value = false;
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
  const start = pointerDragStart.value;
  if (!pointerDragMoved.value && start) {
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) >= 4) {
      pointerDragMoved.value = true;
    }
  }
  updateDragPreview(event);
  dragOverGroupId.value = groupIdFromDropTarget(
    document.elementFromPoint(event.clientX, event.clientY),
  );
}

function onGroupGripClick(groupId: string) {
  if (suppressNextGroupGripClick.value) {
    suppressNextGroupGripClick.value = false;
    return;
  }
  toggleGroup(groupId);
}

function onPointerUp(event: PointerEvent) {
  if (!isActivePointerDrag(pointerDrag.value, event.pointerId)) return;
  event.preventDefault();
  event.stopPropagation();
  updateDragPreview(event);
  if (pointerDrag.value.kind === "group" && pointerDragMoved.value) {
    suppressNextGroupGripClick.value = true;
  }
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

function toggleActionByKey(key: string) {
  const row = sortedActions.value.find((candidate) => candidate.key === key);
  if (row) toggleAction(row);
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
    const confirmed = await confirm({
      title: t("actions.overwriteTitle"),
      message: t("actions.overwriteMessage", { name: conflict.intent.name }),
      confirmLabel: t("capture.overwrite"),
      cancelLabel: t("common.cancel"),
      variant: "danger",
    });
    if (!confirmed) return;
    const index = doc.value.boundaryIntents.findIndex(
      (intent) => intent.id === conflict.intent.id,
    );
    if (index >= 0) doc.value.boundaryIntents.splice(index, 1);
  } else if (conflict) {
    pushToast({ kind: "warning", message: t("actions.prefixConflict", { name: conflict.intent.name }) });
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
  const confirmed = await confirm({
    title: t("common.confirmDeleteTitle"),
    message: t("gestures.deleteIntentConfirm", { name: intent.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
  });
  if (!confirmed) return;
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
  const confirmed = await confirm({
    title: t("common.confirmDeleteTitle"),
    message: t("gestures.deleteIntentConfirm", { name: row.name }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
  });
  if (!confirmed) return;
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

onMounted(() => {
  selectApp(GLOBAL);
  document.addEventListener("pointerdown", closeGroupMenuOnPointerDown);
  document.addEventListener("keydown", closeGroupMenuOnKeydown);
});

onBeforeUnmount(() => {
  clearDrag();
  document.removeEventListener("pointerdown", closeGroupMenuOnPointerDown);
  document.removeEventListener("keydown", closeGroupMenuOnKeydown);
});
</script>

<template>
  <div class="gestures">
    <aside class="gestures__apps">
      <div class="gestures__apps-head">
        <AppButton variant="quiet" size="sm" class="gestures__apps-head-button" @click="exportVisible = true">
          <Download aria-hidden="true" />
          {{ t("gestures.export") }}
        </AppButton>
        <div class="gestures__apps-head-actions">
          <AppButton variant="quiet" size="sm" class="gestures__apps-head-button" @click="addGroup">
            <Plus aria-hidden="true" />
            {{ t("gestures.addGroup") }}
          </AppButton>
          <AppButton variant="quiet" size="sm" class="gestures__apps-head-button" @click="openAddApp">
            <Plus aria-hidden="true" />
            {{ t("gestures.addApp") }}
          </AppButton>
        </div>
      </div>
      <ul class="gestures__app-list">
        <li class="gestures__app-item" :class="{ 'is-active': currentIsGlobal }">
          <button class="gestures__app-select" type="button" :aria-pressed="currentIsGlobal" @click="selectApp(GLOBAL)">
          <span class="gestures__app-identity">
            <AppIcon :label="t('gestures.globalApp')" global />
            <span class="gestures__app-name">{{ t("gestures.globalApp") }}</span>
          </span>
          </button>
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
          <div class="gestures__group-head" @click="toggleGroup(group.id)">
            <span class="gestures__group-icon-slot">
              <ChevronDown
                class="gestures__group-chevron"
                :class="{ 'is-collapsed': isGroupCollapsed(group.id) }"
                aria-hidden="true"
              />
              <button
                class="gestures__drag-grip gestures__group-grip"
                type="button"
                :aria-label="t('gestures.dragGroup', { name: group.name })"
                :title="t('gestures.dragGroup', { name: group.name })"
                @click.stop="onGroupGripClick(group.id)"
                @pointerdown="startDrag('group', group.id, $event)"
              >
                <GripVertical aria-hidden="true" />
              </button>
            </span>
            <button
              class="gestures__group-toggle"
              type="button"
              :aria-expanded="!isGroupCollapsed(group.id)"
              @click.stop="toggleGroup(group.id)"
            >
              <span class="gestures__group-name">{{ group.name }}</span>
              <span class="gestures__group-count">{{ appsInGroup(group.id).length }}</span>
            </button>
            <div class="gestures__group-menu-wrap" @click.stop>
              <button
                class="gestures__group-menu"
                type="button"
                :aria-label="t('gestures.groupMenu', { name: group.name })"
                :title="t('gestures.groupMenu', { name: group.name })"
                :aria-expanded="openGroupMenuId === group.id"
                :aria-controls="`group-menu-${group.id}`"
                @click.stop="toggleGroupMenu(group.id)"
              >
                <MoreHorizontal aria-hidden="true" />
              </button>
              <div v-if="openGroupMenuId === group.id" :id="`group-menu-${group.id}`" class="gestures__group-menu-list" role="menu">
                <button type="button" role="menuitem" @click="renameGroup(group)">
                  <Pencil aria-hidden="true" />
                  {{ t("gestures.renameGroup") }}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  :disabled="group.id === DEFAULT_APP_GROUP_ID"
                  @click="deleteGroup(group)"
                >
                  <Trash2 aria-hidden="true" />
                  {{ t("gestures.deleteGroup") }}
                </button>
              </div>
            </div>
          </div>
          <ul v-if="!isGroupCollapsed(group.id)" class="gestures__group-apps">
            <li
              v-for="(app, appIndex) in appsInGroup(group.id)"
              :key="app.id"
              class="gestures__tree-item"
              :data-tree-position="appIndex === appsInGroup(group.id).length - 1 ? 'last' : 'branch'"
            >
              <div
                class="gestures__app-item"
                :class="{ 'is-active': app.id === selectedAppId, 'is-dragging': isDragging('app', app.id) }"
              >
                <button class="gestures__app-select" type="button" :aria-pressed="app.id === selectedAppId" @click="selectApp(app.id)">
                  <span class="gestures__app-identity">
                    <AppIcon :label="app.name" :windows-exe-name="app.windows?.exeName" :mac-bundle-id="app.mac?.bundleId" />
                    <span class="gestures__app-name">{{ app.name }}</span>
                  </span>
                </button>
                <span class="gestures__app-actions">
                  <button
                    class="gestures__drag-grip gestures__app-grip"
                    type="button"
                    :aria-label="t('gestures.dragApp', { name: app.name })"
                    :title="t('gestures.dragApp', { name: app.name })"
                    @click.stop
                    @pointerdown="startDrag('app', app.id, $event)"
                  >
                    <GripVertical aria-hidden="true" />
                  </button>
                  <button type="button" class="gg-icon-button" :aria-label="t('gestures.editApp')" :title="t('gestures.editApp')" @click="openEditApp(app)">
                    <Pencil aria-hidden="true" />
                  </button>
                  <button
                    :data-testid="`gesture-delete-app-${app.id}`"
                    type="button"
                    class="gg-icon-button gestures__delete-app"
                    :aria-label="t('gestures.deleteApp')"
                    :title="t('gestures.deleteApp')"
                    @click="deleteApp(app)"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </div>
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
            <label class="gestures__setting" for="gestures-inherit-global">
              <span>{{ t("gestures.inheritGlobal") }}</span>
              <input id="gestures-inherit-global" v-model="currentApp.inheritGlobalGestures" class="gg-switch" type="checkbox" />
            </label>
          </template>
          <template v-else>
            <label class="gestures__setting" for="gestures-hot-corners">
              <span>{{ t("actions.enableHotCorners") }}</span>
              <input id="gestures-hot-corners" v-model="doc.hotCorners.enabled" class="gg-switch" type="checkbox" />
            </label>
            <label class="gestures__setting" for="gestures-rub-edges">
              <span>{{ t("actions.enableRubEdges") }}</span>
              <input id="gestures-rub-edges" v-model="doc.rubEdges.enabled" class="gg-switch" type="checkbox" />
            </label>
          </template>
          <label class="gestures__setting gestures__setting--danger" for="gestures-blacklist">
            <span>{{ currentIsGlobal ? t("gestures.blacklistGlobalShort") : t("gestures.blacklistShort") }}</span>
            <input id="gestures-blacklist" v-model="blacklisted" class="gg-switch" type="checkbox" />
          </label>
        </div>
      </header>

      <div v-if="!currentIsGlobal && currentApp" class="gestures__dormant">
        <AppBadge v-if="!currentApp.windows" variant="info">{{ t("gestures.dormantWindows") }}</AppBadge>
        <AppBadge v-if="!currentApp.mac" variant="info">{{ t("gestures.dormantMac") }}</AppBadge>
      </div>

      <div class="gestures__workspace">
        <GestureActionTable
          :rows="actionTableRows"
          :selected-key="selectedIntentId"
          @select="selectIntent"
          @toggle="toggleActionByKey"
        >
          <template #toolbar>
            <AppButton variant="primary" size="sm" @click="openRecordNew">
              <Video aria-hidden="true" />
              {{ t("gestures.addIntent") }}
            </AppButton>
          </template>
        </GestureActionTable>

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
    <AppEntryDialog v-model="appDialogVisible" :app="editingApp" @save="onAppSave" />
    <GestureExportDialog v-model="exportVisible" :config="doc" />
    <SharedAppDialog
      :open="groupNameDialogOpen"
      :title="groupNameTitle"
      :close-label="t('common.cancel')"
      initial-focus="#gesture-group-name"
      @close="groupNameDialogOpen = false"
    >
      <form class="gestures__group-name-form" @submit.prevent="submitGroupName">
        <label class="gg-field-label" for="gesture-group-name">{{ t("gestures.groupNamePrompt") }}</label>
        <input id="gesture-group-name" v-model="groupNameValue" class="gg-input" :placeholder="t('gestures.groupNamePlaceholder')" maxlength="64" />
        <p v-if="groupNameError" class="gestures__group-name-error" role="alert">{{ groupNameError }}</p>
      </form>
      <template #footer>
        <AppButton @click="groupNameDialogOpen = false">{{ t("common.cancel") }}</AppButton>
        <AppButton variant="primary" @click="submitGroupName">{{ t("common.save") }}</AppButton>
      </template>
    </SharedAppDialog>
  </div>
</template>

<style scoped>
.gestures {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gestures__apps {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.gestures__apps-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  align-items: center;
  gap: 4px;
  min-height: 42px;
  padding: 0 6px;
  border-bottom: 1px solid var(--gg-border);
  font-size: 13px;
  color: var(--gg-text-muted);
}
.gestures__apps-head-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  min-width: 0;
  gap: 2px;
}
.gestures__apps-head-button {
  min-width: 0;
  width: 100%;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--gg-text-muted);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.gestures__apps-head-button :deep(svg) {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
.gestures__apps-head-button:hover:not(:disabled) {
  background: transparent;
  color: var(--gg-primary);
}
.gestures__apps-head-button:focus-visible {
  outline-offset: -1px;
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
  border-radius: 6px;
  transition: background-color 120ms ease;
}
.gestures__group.is-drop-target {
  background: var(--gg-primary-soft);
}
.gestures__group.is-dragging,
.gestures__app-item.is-dragging {
  outline: 1px dashed var(--gg-primary);
  outline-offset: -1px;
  background: var(--gg-surface-muted);
  opacity: 0.58;
}
.gestures__drag-preview {
  position: fixed;
  z-index: 3000;
  box-sizing: border-box;
  pointer-events: none;
  opacity: 0.92;
  box-shadow: 0 12px 30px rgb(15 23 42 / 0.16);
}
.gestures__group-head {
  display: flex;
  height: 34px;
  align-items: center;
  min-height: 34px;
  gap: 2px;
  box-sizing: border-box;
  padding: 2px 3px 2px 1px;
  color: var(--gg-text-muted);
  font-size: 12px;
}
.gestures__group-icon-slot {
  position: relative;
  display: inline-grid;
  width: 20px;
  height: 24px;
  flex: 0 0 20px;
  place-items: center;
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
.gestures__group-toggle:hover { color: var(--gg-text); }
.gestures__group-chevron {
  position: absolute;
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--gg-text-subtle);
  transform: rotate(0deg);
  transition: opacity 120ms ease, transform 120ms ease;
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
  color: var(--gg-text-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.gestures__group-menu {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--gg-text-subtle);
  cursor: pointer;
}
.gestures__group-menu:hover,
.gestures__group-menu:focus-visible {
  background: var(--gg-surface-muted);
  color: var(--gg-text);
}
.gestures__group-menu-wrap { position: relative; flex: 0 0 auto; }
.gestures__group-menu-list {
  position: absolute;
  z-index: 8;
  top: calc(100% + 4px);
  right: 0;
  display: grid;
  min-width: 156px;
  padding: 4px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
  box-shadow: 0 10px 24px rgb(15 23 42 / 0.16);
}
.gestures__group-menu-list button {
  display: flex;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--gg-text);
  padding: 0 8px;
  text-align: left;
}
.gestures__group-menu-list button:hover:not(:disabled),
.gestures__group-menu-list button:focus-visible:not(:disabled) { background: var(--gg-surface-muted); }
.gestures__group-menu-list button:disabled { color: var(--gg-text-subtle); cursor: not-allowed; }
.gestures__group-menu-list svg { width: 16px; height: 16px; }
.gestures__group-apps {
  list-style: none;
  margin: 0;
  padding: 0 0 3px 0;
}
.gestures__tree-item {
  position: relative;
  padding-bottom: 4px;
  padding-left: 12px;
}
.gestures__tree-item:last-child {
  padding-bottom: 0;
}
.gestures__tree-item::before,
.gestures__tree-item::after {
  position: absolute;
  left: 11px;
  content: "";
  pointer-events: none;
}
.gestures__tree-item::before {
  top: 0;
  bottom: 0;
  border-left: 1px solid var(--gg-border);
}
.gestures__tree-item::after {
  top: 17px;
  width: 8px;
  border-top: 1px solid var(--gg-border);
}
.gestures__tree-item[data-tree-position="last"]::before {
  bottom: auto;
  height: 17px;
}
.gestures__app-item {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 5px;
  min-height: 34px;
  box-sizing: border-box;
  padding: 4px 7px;
  border-radius: 6px;
  font-size: 14px;
}
.gestures__app-identity {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 8px;
}
.gestures__app-select {
  display: flex;
  height: 24px;
  min-width: 0;
  flex: 1;
  align-items: center;
  min-height: 0;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  text-align: left;
}
.gestures__app-item:hover {
  background: var(--gg-surface-muted);
}
.gestures__app-item.is-active {
  background: var(--gg-primary-soft);
  color: var(--gg-primary);
  font-weight: 600;
}
.gestures__app-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gestures__app-actions {
  display: none;
  align-items: center;
  flex-shrink: 0;
}
.gestures__app-item:hover .gestures__app-actions,
.gestures__app-item:focus-within .gestures__app-actions {
  display: inline-flex;
}
.gestures__app-actions .gg-icon-button :deep(svg) {
  width: 16px;
  height: 16px;
}
.gestures__app-actions .gg-icon-button {
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  box-sizing: border-box;
  padding: 0;
}
.gestures__drag-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 24px;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--gg-text-subtle);
  cursor: grab;
  opacity: 0;
  touch-action: none;
  user-select: none;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}
.gestures__drag-grip:active { cursor: grabbing; }
.gestures__drag-grip svg { width: 16px; height: 16px; }
.gestures__group-grip {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}
.gestures__group-head:hover .gestures__group-chevron,
.gestures__group-head:focus-within .gestures__group-chevron,
.gestures__group-grip:focus-visible {
  opacity: 0;
}
.gestures__group-head:hover .gestures__group-grip,
.gestures__group-head:focus-within .gestures__group-grip,
.gestures__group-grip:focus-visible,
.gestures__app-item:hover .gestures__app-grip,
.gestures__app-item:focus-within .gestures__app-grip,
.gestures__drag-grip:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.gestures__drag-grip:hover,
.gestures__drag-grip:focus-visible {
  background: var(--gg-surface-muted);
  color: var(--gg-text);
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
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface-muted);
}
.gestures__setting {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: var(--gg-text);
  font-size: 12px;
  white-space: nowrap;
}
.gestures__setting--danger {
  color: var(--gg-danger);
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
.gestures__workspace > :deep(.gesture-action-table) {
  border: 1px solid var(--gg-border);
  border-radius: 6px;
}
.gestures__editor-pane {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
  overflow: hidden;
}
.gestures__group-name-form { display: grid; gap: 8px; }
.gestures__group-name-error { margin: 0; color: var(--gg-danger); font-size: 13px; }
.gestures__editor-pane {
  padding: 12px 14px;
  overflow-y: auto;
}
</style>
