<script setup lang="ts">
import { computed, reactive, ref, watch, type Directive } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-vue-next";
import { AppAlert, AppBadge, AppButton, AppDialog, pushToast } from "@godgesture/ui";
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
const pendingQuota = ref<{ usage: { submissionsToday: number; pendingVersions: number; publishedTemplates: number }; limits: { dailySubmissionLimit: number; pendingVersionLimit: number; publishedTemplateLimit: number; maxPackageBytes: number } } | null>(null);

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

const vIndeterminate: Directive<HTMLInputElement, boolean> = {
  mounted(element, binding) {
    element.indeterminate = binding.value;
  },
  updated(element, binding) {
    element.indeterminate = binding.value;
  },
};

function selectAll() {
  selectedIds.value = [...allSelectableIds.value];
}

function clearSelection() {
  selectedIds.value = [];
}

function selectionChanged(id: string, event: Event) {
  setSelected(id, (event.target as HTMLInputElement).checked);
}

function groupSelectionState(group: AppGroup): "checked" | "mixed" | "unchecked" {
  const ids = selectableIdsForGroup(group);
  const selected = selectedCountFor(ids);
  if (ids.length > 0 && selected === ids.length) return "checked";
  if (selected > 0) return "mixed";
  return "unchecked";
}

function requestClose() {
  if (!exporting.value) visible.value = false;
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
  pendingQuota.value = null;
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
      pendingQuota.value = await account.publicTemplateSubmissionPolicy();
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
    pushToast({ kind: "success", message: t("gestures.exportDialog.success", {
      targets: selectedTargets.value.length,
      gestures: selectedGestureCount.value,
    }) });
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
  try {
    const result = await account.submitPublicTemplate(pendingPackage.value);
    pushToast({ kind: "success", message: t("gestures.exportDialog.submitted", { id: result.id }) });
    reviewVisible.value = false;
    visible.value = false;
  }
  catch { validationError.value = t("gestures.exportDialog.failed"); }
  finally { exporting.value = false; }
}
</script>

<template>
  <AppDialog
    :open="visible"
    class="gesture-export-dialog"
    :title="t('gestures.exportDialog.title')"
    :close-label="t('common.close')"
    :busy="exporting"
    @close="requestClose"
  >
    <div class="gesture-export">
      <p class="gg-hint gesture-export__intro">{{ t("gestures.exportDialog.description") }}</p>

      <section class="gesture-export__section">
        <form class="gesture-export__form" @submit.prevent="exportSelected()">
          <div class="gesture-export__form-grid">
            <div class="gesture-export__form-column">
              <div class="gesture-export__field">
                <label for="gesture-export-title">{{ t("gestures.exportDialog.templateTitle") }}</label>
                <input id="gesture-export-title" v-model="form.title" class="gg-input" type="text" maxlength="120" />
                <span class="gesture-export__field-count" aria-live="polite">{{ form.title.length }} / 120</span>
              </div>
              <div class="gesture-export__field">
                <label for="gesture-export-tags">{{ t("gestures.exportDialog.tags") }}</label>
                <input
                  id="gesture-export-tags"
                  v-model="form.tags"
                  class="gg-input"
                  type="text"
                  :placeholder="t('gestures.exportDialog.tagsPlaceholder')"
                />
              </div>
            </div>
            <div class="gesture-export__field gesture-export__summary-field">
              <label for="gesture-export-summary">{{ t("gestures.exportDialog.templateSummary") }}</label>
              <textarea
                id="gesture-export-summary"
                v-model="form.summary"
                class="gg-textarea"
                rows="4"
                maxlength="512"
              />
              <span class="gesture-export__field-count" aria-live="polite">{{ form.summary.length }} / 512</span>
            </div>
          </div>
        </form>
      </section>

      <section class="gesture-export__section gesture-export__targets">
        <div class="gesture-export__section-head">
          <div>
            <h3>{{ t("gestures.exportDialog.targetsTitle") }}</h3>
            <p class="gg-hint">{{ t("gestures.exportDialog.targetsHint") }}</p>
          </div>
          <AppBadge class="gesture-export__selection-count" variant="neutral">
            {{ t("gestures.exportDialog.selectedCount", { count: selectedTargets.length, gestures: selectedGestureCount }) }}
          </AppBadge>
        </div>

        <div class="gesture-export__target-toolbar">
          <div class="gesture-export__search">
            <Search aria-hidden="true" />
            <input
              id="gesture-export-search"
              v-model="query"
              class="gg-input"
              type="search"
              :aria-label="t('gestures.exportDialog.searchPlaceholder')"
              :placeholder="t('gestures.exportDialog.searchPlaceholder')"
            />
          </div>
          <div class="gesture-export__target-actions">
            <AppButton variant="quiet" size="sm" @click="selectAll">{{ t("gestures.exportDialog.selectAll") }}</AppButton>
            <AppButton variant="quiet" size="sm" @click="clearSelection">{{ t("gestures.exportDialog.clearSelection") }}</AppButton>
            <AppButton variant="quiet" size="sm" @click="setAllGroupsExpanded(true)">
              {{ t("gestures.exportDialog.expandAll") }}
            </AppButton>
            <AppButton variant="quiet" size="sm" @click="setAllGroupsExpanded(false)">
              {{ t("gestures.exportDialog.collapseAll") }}
            </AppButton>
          </div>
        </div>

        <div class="gesture-export__target-list">
          <label v-if="globalVisible" class="gesture-export__target-row">
            <input
              id="gesture-export-target-global"
              class="gg-checkbox"
              type="checkbox"
              :checked="isSelected('__global__')"
              :disabled="!targetCanExport(globalTarget())"
              @change="selectionChanged('__global__', $event)"
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
                <ChevronDown v-if="isGroupExpanded(item.group.id)" aria-hidden="true" />
                <ChevronRight v-else aria-hidden="true" />
                <span>{{ item.group.name }}</span>
                <span class="gesture-export__group-count">{{ item.apps.length }}</span>
              </button>
              <label class="gesture-export__group-select">
                <input
                  v-indeterminate="groupSelectionState(item.group) === 'mixed'"
                  class="gg-checkbox"
                  type="checkbox"
                  :checked="groupSelectionState(item.group) === 'checked'"
                  :disabled="selectableIdsForGroup(item.group).length === 0"
                  @change="toggleGroup(item.group)"
                />
                {{ t("gestures.exportDialog.selectGroup") }}
              </label>
            </div>
            <div v-if="isGroupExpanded(item.group.id)" class="gesture-export__group-apps">
              <label
                v-for="app in item.apps"
                :key="app.id"
                class="gesture-export__target-row gesture-export__target-row--app"
              :class="{ 'is-disabled': !targetCanExport(targetForApp(app)) }"
            >
                <input
                  class="gg-checkbox"
                  type="checkbox"
                  :checked="isSelected(app.id)"
                  :disabled="!targetCanExport(targetForApp(app))"
                  @change="selectionChanged(app.id, $event)"
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

      <AppAlert
        v-if="selectedPluginIds.length"
        class="gesture-export__alert"
        variant="warning"
        :title="t('gestures.exportDialog.pluginSourceMissing', { ids: selectedPluginIds.join(', ') })"
      />
      <AppAlert
        v-if="validationError"
        class="gesture-export__alert"
        variant="error"
        :title="validationError"
      />
    </div>

    <template #footer>
      <AppButton :disabled="exporting" @click="requestClose">{{ t("common.cancel") }}</AppButton>
      <AppButton
        v-if="canSubmitPublic"
        variant="secondary"
        :loading="exporting"
        :disabled="!canExport"
        @click="exportSelected(true)"
      >
        {{ t("gestures.exportDialog.submitPublic") }}
      </AppButton>
      <AppButton
        variant="primary"
        :loading="exporting"
        :disabled="!canExport"
        @click="exportSelected()"
      >
        <Download aria-hidden="true" />
        {{ t("gestures.exportDialog.export") }}
      </AppButton>
    </template>
  </AppDialog>
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
    :usage="pendingQuota?.usage ?? { submissionsToday: 0, pendingVersions: 0, publishedTemplates: 0 }"
    :limits="pendingQuota?.limits ?? { dailySubmissionLimit: 0, pendingVersionLimit: 0, publishedTemplateLimit: 0, maxPackageBytes: 0 }"
    :busy="exporting"
    @confirm="confirmPublicSubmission"
  />
</template>

<style scoped>
.gesture-export { min-width: 0; }
.gesture-export__intro { margin: 0 0 12px; }
.gesture-export__section {
  border-top: 1px solid var(--gg-border);
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
  color: var(--gg-text);
  font-size: 13px;
  line-height: 20px;
}
.gesture-export__section-head p { margin: 3px 0 0; }
.gesture-export__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 0 12px;
}
.gesture-export__form-column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}
.gesture-export__field {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 5px;
}
.gesture-export__field > label {
  color: var(--gg-text);
  font-size: 12px;
  font-weight: 600;
}
.gesture-export__field-count {
  color: var(--gg-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.gesture-export__summary-field {
  display: flex;
  min-height: 0;
  flex-direction: column;
  flex: 1;
}
.gesture-export__summary-field textarea { flex: 1; resize: vertical; }
.gesture-export__selection-count {
  flex: 0 0 auto;
  color: var(--gg-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.gesture-export__target-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.gesture-export__search {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 300px;
  flex: 1 1 200px;
  gap: 8px;
  color: var(--gg-text-muted);
}
.gesture-export__search svg { flex: 0 0 auto; width: 16px; height: 16px; }
.gesture-export__search input { min-width: 0; width: 100%; }
.gesture-export__target-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  margin-left: auto;
}
.gesture-export__target-list {
  max-height: 250px;
  overflow: auto;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface-muted);
}
.gesture-export__target-row {
  display: flex;
  align-items: center;
  min-height: 40px;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--gg-border);
  color: var(--gg-text);
  font-size: 13px;
}
.gesture-export__target-row:last-child { border-bottom: 0; }
.gesture-export__target-row--app { padding-left: 34px; }
.gesture-export__target-row.is-disabled { color: var(--gg-text-muted); }
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
  color: var(--gg-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gesture-export__target-count,
.gesture-export__group-count {
  flex: 0 0 auto;
  color: var(--gg-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.gesture-export__group-head {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--gg-border);
  background: var(--gg-surface);
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
  color: var(--gg-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}
.gesture-export__group-toggle svg { width: 16px; height: 16px; flex: 0 0 auto; }
.gesture-export__group-toggle:hover { color: var(--gg-primary); }
.gesture-export__group-toggle:focus-visible { outline: 2px solid var(--gg-primary); outline-offset: 2px; }
.gesture-export__group-toggle span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gesture-export__group-select {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  gap: 6px;
  color: var(--gg-text-muted);
  font-size: 12px;
  white-space: nowrap;
}
.gesture-export__group-apps { background: var(--gg-surface); }
.gesture-export__empty {
  padding: 18px 12px;
  color: var(--gg-text-muted);
  font-size: 12px;
  text-align: center;
}
.gesture-export__alert { margin-top: 10px; }
</style>
