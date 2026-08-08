<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { ArrowDown, ArrowRight, Download, Search } from "@element-plus/icons-vue";
import { gestureTemplatePackageRisks, type AppEntry, type AppGroup, type ConfigDocument } from "@godgesture/shared";
import {
  buildGestureTemplatePackage,
  intentsForGestureExportTarget,
  nodePluginIdsInIntents,
  gestureTemplateExportFileName,
  type GestureExportMetadata,
  type GestureExportTarget,
} from "../utils/gesture-export";
import { useBackend } from "../api/backend";
import { useAccountStore } from "../stores/account";
import TemplateSubmissionReview from "./TemplateSubmissionReview.vue";
import { canSubmitPublicTemplate, submissionAuthor } from "../utils/template-submission";

const props = defineProps<{
  modelValue: boolean;
  config: ConfigDocument;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void;
}>();

const { t } = useI18n();
const backend = useBackend();
const account = useAccountStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

interface ExportForm {
  title: string;
  summary: string;
  tags: string;
}

const form = reactive<ExportForm>({
  title: "",
  summary: "",
  tags: "",
});
const query = ref("");
const selectedIds = ref<string[]>([]);
const expandedGroups = ref<Record<string, boolean>>({});
const validationError = ref<string | null>(null);
const exporting = ref(false);
const reviewVisible = ref(false);
const pendingPackage = ref<unknown>(null);
const pendingReview = ref<{ title: string; summary: string; author: string } | null>(null);
const pendingRisks = ref<string[]>([]);

const sortedGroups = computed(() =>
  [...props.config.groups].sort((left, right) => left.order - right.order),
);

function sortedApps(groupId: string): AppEntry[] {
  return props.config.apps
    .filter((app) => app.groupId === groupId)
    .sort((left, right) => left.order - right.order);
}

function targetForApp(app: AppEntry): GestureExportTarget {
  return { scope: "app", id: app.id, app };
}

function globalTarget(): GestureExportTarget {
  return { scope: "global", id: "__global__" };
}

function targetIntents(target: GestureExportTarget) {
  return intentsForGestureExportTarget(props.config, target);
}

function targetHasGestures(target: GestureExportTarget): boolean {
  return targetIntents(target).length > 0;
}

function targetCanExport(target: GestureExportTarget): boolean {
  return targetHasGestures(target) && (
    target.scope === "global" || Boolean(target.app.windows || target.app.mac)
  );
}

function targetPluginIds(target: GestureExportTarget): string[] {
  return nodePluginIdsInIntents(targetIntents(target));
}

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id);
}

function setSelected(id: string, selected: boolean) {
  if (selected && !selectedIds.value.includes(id)) {
    selectedIds.value = [...selectedIds.value, id];
  } else if (!selected) {
    selectedIds.value = selectedIds.value.filter((value) => value !== id);
  }
}

function selectableIdsForGroup(group: AppGroup): string[] {
  return sortedApps(group.id)
    .filter((app) => targetCanExport(targetForApp(app)))
    .map((app) => app.id);
}

function selectedCountFor(ids: readonly string[]): number {
  return ids.filter((id) => isSelected(id)).length;
}

function toggleGroup(group: AppGroup) {
  const ids = selectableIdsForGroup(group);
  const allSelected = ids.length > 0 && selectedCountFor(ids) === ids.length;
  const next = new Set(selectedIds.value);
  ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
  selectedIds.value = [...next];
}

function isGroupExpanded(groupId: string): boolean {
  return Boolean(query.value.trim()) || expandedGroups.value[groupId] === true;
}

function toggleGroupExpanded(groupId: string) {
  expandedGroups.value[groupId] = !isGroupExpanded(groupId);
}

function setAllGroupsExpanded(expanded: boolean) {
  expandedGroups.value = Object.fromEntries(
    sortedGroups.value.map((group) => [group.id, expanded]),
  );
}

function appMatches(app: AppEntry, needle: string): boolean {
  if (!needle) return true;
  return [
    app.name,
    app.windows?.exeName ?? "",
    app.windows?.aumid ?? "",
    app.mac?.bundleId ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

const filteredGroups = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return sortedGroups.value
    .map((group) => {
      const apps = sortedApps(group.id);
      const groupMatches = group.name.toLocaleLowerCase().includes(needle);
      return {
        group,
        apps: groupMatches ? apps : apps.filter((app) => appMatches(app, needle)),
      };
    })
    .filter(({ group, apps }) => {
      if (!needle) return true;
      return group.name.toLocaleLowerCase().includes(needle) || apps.length > 0;
    });
});

const globalVisible = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return true;
  if (t("gestures.globalApp").toLocaleLowerCase().includes(needle)) return true;
  return props.config.global.intents.some((intent) =>
    intent.name.toLocaleLowerCase().includes(needle),
  );
});

const allSelectableIds = computed(() => [
  ...(targetCanExport(globalTarget()) ? ["__global__"] : []),
  ...props.config.apps
    .filter((app) => targetCanExport(targetForApp(app)))
    .map((app) => app.id),
]);

const selectedTargets = computed<GestureExportTarget[]>(() => {
  const targets: GestureExportTarget[] = [];
  if (isSelected("__global__")) targets.push(globalTarget());
  props.config.apps.forEach((app) => {
    if (isSelected(app.id)) targets.push(targetForApp(app));
  });
  return targets.filter(targetCanExport);
});

const selectedGestureCount = computed(() =>
  selectedTargets.value.reduce((total, target) => total + targetIntents(target).length, 0),
);

const selectedPluginIds = computed(() => [
  ...new Set(selectedTargets.value.flatMap((target) => targetPluginIds(target))),
]);

const canExport = computed(() =>
  !exporting.value && selectedTargets.value.length > 0 && selectedPluginIds.value.length === 0,
);
const canSubmitPublic = computed(() => canSubmitPublicTemplate({ endpointMode: account.endpointMode, phase: account.phase, emailVerified: Boolean(account.user?.emailVerified) }));

function selectAll() {
  selectedIds.value = [...allSelectableIds.value];
}

function clearSelection() {
  selectedIds.value = [];
}

function reset() {
  form.title = "";
  form.summary = "";
  form.tags = "";
  query.value = "";
  selectedIds.value = [];
  expandedGroups.value = Object.fromEntries(
    sortedGroups.value.map((group) => [group.id, false]),
  );
  validationError.value = null;
  reviewVisible.value = false;
  pendingPackage.value = null;
  pendingReview.value = null;
  pendingRisks.value = [];
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
    else validationError.value = null;
  },
  { immediate: true },
);

watch(
  () => [form.title, form.summary, form.tags, selectedIds.value],
  () => {
    validationError.value = null;
  },
);

function parseTags(): string[] {
  return [...new Set(
    form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  )];
}

function metadata(): GestureExportMetadata | null {
  const title = form.title.trim();
  const summary = form.summary.trim();
  const tags = parseTags();

  if (!title || !summary) {
    validationError.value = t("gestures.exportDialog.requiredFields");
  } else if (title.length > 120 || summary.length > 512) {
    validationError.value = t("gestures.exportDialog.invalidTextLength");
  } else if (tags.length > 8 || tags.some((tag) => tag.length > 32)) {
    validationError.value = t("gestures.exportDialog.invalidTags");
  } else {
    return {
      author: submissionAuthor(account.user?.displayName, account.user?.email),
      title,
      summary,
      tags,
    };
  }
  return null;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportSelected(submitPublic = false) {
  const details = metadata();
  if (!details) return;
  if (selectedTargets.value.length === 0) {
    validationError.value = t("gestures.exportDialog.selectTarget");
    return;
  }
  if (selectedPluginIds.value.length > 0) {
    validationError.value = t("gestures.exportDialog.pluginSourceMissing", {
      ids: selectedPluginIds.value.join(", "),
    });
    return;
  }

  exporting.value = true;
  try {
    const packageValue = buildGestureTemplatePackage(
      selectedTargets.value.map((target) => ({
        target,
        intents: targetIntents(target),
      })),
      details,
    );
    const serialized = `${JSON.stringify(packageValue, null, 2)}\n`;
    if (submitPublic) {
      if (!canSubmitPublic.value) return;
      pendingPackage.value = packageValue;
      pendingReview.value = { title: details.title, summary: details.summary, author: details.author ?? "-" };
      pendingRisks.value = gestureTemplatePackageRisks(packageValue);
      reviewVisible.value = true;
      return;
    } else if (backend.isTauri) {
      const savedPath = await backend.gestureTemplateSave(
        gestureTemplateExportFileName(),
        serialized,
        t("gestures.exportDialog.saveTitle"),
      );
      if (!savedPath) return;
    } else {
      downloadJson(gestureTemplateExportFileName(), packageValue);
    }
    ElMessage.success(t("gestures.exportDialog.success", {
      targets: selectedTargets.value.length,
      gestures: selectedGestureCount.value,
    }));
    visible.value = false;
  } catch {
    validationError.value = t("gestures.exportDialog.failed");
  } finally {
    exporting.value = false;
  }
}

async function confirmPublicSubmission() {
  if (!pendingPackage.value) return;
  exporting.value = true;
  try { const result = await account.submitPublicTemplate(pendingPackage.value); ElMessage.success(t("gestures.exportDialog.submitted", { id: result.id })); reviewVisible.value = false; visible.value = false; }
  catch { validationError.value = t("gestures.exportDialog.failed"); }
  finally { exporting.value = false; }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="gesture-export-dialog"
    :title="t('gestures.exportDialog.title')"
    width="min(820px, calc(100vw - 32px))"
    top="4vh"
    destroy-on-close
    :close-on-click-modal="!exporting"
    :close-on-press-escape="!exporting"
    :show-close="!exporting"
  >
    <div class="gesture-export">
      <p class="gg-hint gesture-export__intro">{{ t("gestures.exportDialog.description") }}</p>

      <section class="gesture-export__section">
        <div class="gesture-export__section-head">
          <div>
            <h3>{{ t("gestures.exportDialog.metadataTitle") }}</h3>
            <p class="gg-hint">{{ t("gestures.exportDialog.metadataHint") }}</p>
          </div>
          <el-tag size="small" effect="plain">v2</el-tag>
        </div>
        <el-form label-position="top" class="gesture-export__form" @submit.prevent="exportSelected">
          <div class="gesture-export__form-grid gesture-export__form-grid--identity">
            <el-form-item :label="t('gestures.exportDialog.tags')">
              <el-input v-model="form.tags" :placeholder="t('gestures.exportDialog.tagsPlaceholder')" />
            </el-form-item>
          </div>
          <div class="gesture-export__form-grid">
            <el-form-item :label="t('gestures.exportDialog.templateTitle')">
              <el-input v-model="form.title" :maxlength="120" show-word-limit />
            </el-form-item>
            <el-form-item :label="t('gestures.exportDialog.templateSummary')">
              <el-input v-model="form.summary" type="textarea" :rows="2" :maxlength="512" show-word-limit />
            </el-form-item>
          </div>
        </el-form>
      </section>

      <section class="gesture-export__section gesture-export__targets">
        <div class="gesture-export__section-head">
          <div>
            <h3>{{ t("gestures.exportDialog.targetsTitle") }}</h3>
            <p class="gg-hint">{{ t("gestures.exportDialog.targetsHint") }}</p>
          </div>
          <span class="gesture-export__selection-count">
            {{ t("gestures.exportDialog.selectedCount", { count: selectedTargets.length, gestures: selectedGestureCount }) }}
          </span>
        </div>

        <div class="gesture-export__target-toolbar">
          <el-input
            v-model="query"
            clearable
            :prefix-icon="Search"
            :placeholder="t('gestures.exportDialog.searchPlaceholder')"
          />
          <div class="gesture-export__target-actions">
            <el-button link size="small" @click="selectAll">{{ t("gestures.exportDialog.selectAll") }}</el-button>
            <el-button link size="small" @click="clearSelection">{{ t("gestures.exportDialog.clearSelection") }}</el-button>
            <el-button link size="small" @click="setAllGroupsExpanded(true)">
              {{ t("gestures.exportDialog.expandAll") }}
            </el-button>
            <el-button link size="small" @click="setAllGroupsExpanded(false)">
              {{ t("gestures.exportDialog.collapseAll") }}
            </el-button>
          </div>
        </div>

        <div class="gesture-export__target-list">
          <label v-if="globalVisible" class="gesture-export__target-row">
            <el-checkbox
              :model-value="isSelected('__global__')"
              :disabled="!targetCanExport(globalTarget())"
              @change="setSelected('__global__', Boolean($event))"
            />
            <span class="gesture-export__target-name">{{ t("gestures.globalApp") }}</span>
            <span class="gesture-export__target-count">
              {{ targetIntents(globalTarget()).length }}
            </span>
          </label>
          <div v-if="!globalVisible && filteredGroups.length === 0" class="gesture-export__empty">
            {{ t("gestures.exportDialog.noResults") }}
          </div>

          <div v-for="item in filteredGroups" :key="item.group.id" class="gesture-export__group">
            <div class="gesture-export__group-head">
              <button
                type="button"
                class="gesture-export__group-toggle"
                :aria-expanded="isGroupExpanded(item.group.id)"
                @click="toggleGroupExpanded(item.group.id)"
              >
                <el-icon aria-hidden="true">
                  <ArrowDown v-if="isGroupExpanded(item.group.id)" />
                  <ArrowRight v-else />
                </el-icon>
                <span>{{ item.group.name }}</span>
                <span class="gesture-export__group-count">{{ item.apps.length }}</span>
              </button>
              <el-checkbox
                :model-value="selectedCountFor(selectableIdsForGroup(item.group)) === selectableIdsForGroup(item.group).length && selectableIdsForGroup(item.group).length > 0"
                :indeterminate="selectedCountFor(selectableIdsForGroup(item.group)) > 0 && selectedCountFor(selectableIdsForGroup(item.group)) < selectableIdsForGroup(item.group).length"
                :disabled="selectableIdsForGroup(item.group).length === 0"
                @change="toggleGroup(item.group)"
              >
                {{ t("gestures.exportDialog.selectGroup") }}
              </el-checkbox>
            </div>
            <div v-if="isGroupExpanded(item.group.id)" class="gesture-export__group-apps">
              <label
                v-for="app in item.apps"
                :key="app.id"
                class="gesture-export__target-row gesture-export__target-row--app"
                :class="{ 'is-disabled': !targetCanExport(targetForApp(app)) }"
              >
                <el-checkbox
                  :model-value="isSelected(app.id)"
                  :disabled="!targetCanExport(targetForApp(app))"
                  @change="setSelected(app.id, Boolean($event))"
                />
                <span class="gesture-export__target-name">{{ app.name }}</span>
                <span class="gesture-export__target-binding">
                  {{ app.windows?.exeName || app.mac?.bundleId || t("gestures.exportDialog.noBinding") }}
                </span>
                <span class="gesture-export__target-count">{{ app.intents.length }}</span>
              </label>
            </div>
          </div>
          <div v-if="globalVisible && filteredGroups.length === 0" class="gesture-export__empty">
            {{ t("gestures.exportDialog.noApps") }}
          </div>
        </div>
      </section>

      <el-alert
        v-if="selectedPluginIds.length"
        class="gesture-export__alert"
        type="warning"
        show-icon
        :closable="false"
        :title="t('gestures.exportDialog.pluginSourceMissing', { ids: selectedPluginIds.join(', ') })"
      />
      <el-alert
        v-if="validationError"
        class="gesture-export__alert"
        type="error"
        show-icon
        :closable="false"
        :title="validationError"
      />
    </div>

    <template #footer>
      <el-button :disabled="exporting" @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button
        v-if="canSubmitPublic"
        type="success"
        :loading="exporting"
        :disabled="!canExport"
        @click="exportSelected(true)"
      >
        {{ t("gestures.exportDialog.submitPublic") }}
      </el-button>
      <el-button
        type="primary"
        :icon="Download"
        :loading="exporting"
        :disabled="!canExport"
        @click="exportSelected"
      >
        {{ t("gestures.exportDialog.export") }}
      </el-button>
    </template>
  </el-dialog>
  <TemplateSubmissionReview
    v-if="pendingReview"
    v-model="reviewVisible"
    :title="pendingReview.title"
    :summary="pendingReview.summary"
    :author="pendingReview.author"
    :targets="selectedTargets.length"
    :gestures="selectedGestureCount"
    :risks="pendingRisks"
    :plugins="selectedPluginIds"
    @confirm="confirmPublicSubmission"
  />
</template>

<style scoped>
.gesture-export { min-width: 0; }
.gesture-export__intro { margin: 0 0 12px; }
.gesture-export__section {
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 12px;
  margin-top: 12px;
}
.gesture-export__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.gesture-export__section-head h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 20px;
}
.gesture-export__section-head p { margin: 3px 0 0; }
.gesture-export__form :deep(.el-form-item) { margin-bottom: 10px; }
.gesture-export__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}
.gesture-export__form-grid--identity { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.gesture-export__selection-count {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.gesture-export__target-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.gesture-export__target-toolbar > .el-input { max-width: 300px; }
.gesture-export__target-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  margin-left: auto;
}
.gesture-export__target-list {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 5px;
  background: var(--el-bg-color-page);
}
.gesture-export__target-row {
  display: flex;
  align-items: center;
  min-height: 34px;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  color: var(--el-text-color-primary);
  font-size: 13px;
}
.gesture-export__target-row:last-child { border-bottom: 0; }
.gesture-export__target-row--app { padding-left: 34px; }
.gesture-export__target-row.is-disabled { color: var(--el-text-color-placeholder); }
.gesture-export__target-name {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gesture-export__target-binding {
  max-width: 210px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gesture-export__target-count,
.gesture-export__group-count {
  flex: 0 0 auto;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.gesture-export__group-head {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  background: var(--el-fill-color-extra-light);
}
.gesture-export__group-toggle {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.gesture-export__group-toggle:hover { color: var(--el-color-primary); }
.gesture-export__group-toggle span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gesture-export__group-apps { background: var(--el-bg-color); }
.gesture-export__empty {
  padding: 18px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: center;
}
.gesture-export__alert { margin-top: 10px; }
@media (max-width: 700px) {
  .gesture-export__form-grid--identity,
  .gesture-export__form-grid { grid-template-columns: 1fr; }
  .gesture-export__target-toolbar { align-items: stretch; flex-direction: column; }
  .gesture-export__target-toolbar > .el-input { max-width: none; }
  .gesture-export__target-actions { margin-left: 0; }
  .gesture-export__target-binding { max-width: 120px; }
}
</style>
