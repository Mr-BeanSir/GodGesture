<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { Check, DocumentChecked } from "@element-plus/icons-vue";
import type { LegacyImportResult } from "@godgesture/shared";
import { BackendError } from "../api/backend";
import { useConfigStore } from "../stores/config";
import { appLog } from "../logging";
import {
  LegacyImportPreparationError,
  assertLegacyImportFileSize,
  formatLegacyImportDiagnostic,
  prepareLegacyImport,
  type LegacyImportPreview,
} from "../utils/legacyImport";

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t } = useI18n();
const store = useConfigStore();
const gesturesFile = ref<File | null>(null);
const plistFile = ref<File | null>(null);
const result = ref<LegacyImportResult | null>(null);
const preview = ref<LegacyImportPreview | null>(null);
const preparing = ref(false);
const applying = ref(false);
const errorKey = ref<string | null>(null);
const errorSource = ref<string | null>(null);
const inputGeneration = ref(0);

const canPrepare = computed(() => gesturesFile.value !== null && !preparing.value && !applying.value);
const diagnostics = computed(() =>
  (result.value?.warnings ?? []).map((warning) => formatLegacyImportDiagnostic(warning, t)),
);

function resetPreparedState() {
  result.value = null;
  preview.value = null;
  errorKey.value = null;
  errorSource.value = null;
}

function selectFile(event: Event, source: "gestures.wg2" | "config.plist") {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (source === "gestures.wg2") gesturesFile.value = file;
  else plistFile.value = file;
  resetPreparedState();
}

function clearPlist() {
  plistFile.value = null;
  inputGeneration.value += 1;
  resetPreparedState();
}

function showPreparationError(error: unknown) {
  appLog.error("legacy-import", `准备导入失败: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof LegacyImportPreparationError) {
    errorKey.value = `options.legacyImport.error.${error.code}`;
    errorSource.value = error.source ?? null;
  } else {
    errorKey.value = "options.legacyImport.error.parse_failed";
    errorSource.value = "gestures.wg2";
  }
}

async function prepare() {
  if (!gesturesFile.value) {
    errorKey.value = "options.legacyImport.error.gestures_required";
    return;
  }
  preparing.value = true;
  resetPreparedState();
  try {
    assertLegacyImportFileSize(gesturesFile.value.size, "gestures.wg2");
    if (plistFile.value) assertLegacyImportFileSize(plistFile.value.size, "config.plist");

    let gesturesWg2: string;
    let configPlist: string | undefined;
    try {
      gesturesWg2 = await gesturesFile.value.text();
    } catch (error) {
      throw new LegacyImportPreparationError("read_failed", "gestures.wg2", error);
    }
    if (plistFile.value) {
      try {
        configPlist = await plistFile.value.text();
      } catch (error) {
        throw new LegacyImportPreparationError("read_failed", "config.plist", error);
      }
    }

    const prepared = prepareLegacyImport({
      gesturesWg2,
      ...(configPlist === undefined ? {} : { configPlist }),
    });
    result.value = prepared.result;
    preview.value = prepared.preview;
  } catch (error) {
    showPreparationError(error);
  } finally {
    preparing.value = false;
  }
}

async function applyImport() {
  if (!result.value || applying.value) return;
  applying.value = true;
  errorKey.value = null;
  try {
    await store.applyLegacyImport(result.value);
    ElMessage.success(t("options.legacyImport.success"));
    emit("update:modelValue", false);
  } catch (error) {
    appLog.error("legacy-import", `应用导入失败: ${error instanceof Error ? error.message : String(error)}`);
    errorKey.value =
      error instanceof BackendError && error.code === "rollback_incomplete"
        ? "options.legacyImport.error.rollback_incomplete"
        : "options.legacyImport.error.apply_failed";
  } finally {
    applying.value = false;
  }
}

function close() {
  if (!applying.value) emit("update:modelValue", false);
}

function reset() {
  gesturesFile.value = null;
  plistFile.value = null;
  resetPreparedState();
  preparing.value = false;
  applying.value = false;
  inputGeneration.value += 1;
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('options.legacyImport.title')"
    width="min(640px, calc(100vw - 32px))"
    :close-on-click-modal="!applying"
    :close-on-press-escape="!applying"
    :show-close="!applying"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="reset"
  >
    <div class="legacy-import">
      <template v-if="!preview">
        <p class="gg-hint">{{ t("options.legacyImport.description") }}</p>

        <label class="legacy-import__file">
          <span class="gg-field-label">{{ t("options.legacyImport.gesturesFile") }}</span>
          <input
            :key="`gestures-${inputGeneration}`"
            type="file"
            accept=".wg2,application/json"
            :disabled="preparing || applying"
            @change="selectFile($event, 'gestures.wg2')"
          />
        </label>

        <label class="legacy-import__file">
          <span class="gg-field-label">{{ t("options.legacyImport.plistFile") }}</span>
          <div class="legacy-import__file-row">
            <input
              :key="`plist-${inputGeneration}`"
              type="file"
              accept=".plist,application/xml,text/xml"
              :disabled="preparing || applying"
              @change="selectFile($event, 'config.plist')"
            />
            <el-button v-if="plistFile" text size="small" @click="clearPlist">
              {{ t("common.clear") }}
            </el-button>
          </div>
        </label>

        <p class="gg-hint">{{ t("options.legacyImport.fileLimit") }}</p>
        <el-alert
          v-if="!plistFile"
          type="info"
          :closable="false"
          :title="t('options.legacyImport.noPlist')"
          show-icon
        />
      </template>

      <template v-else>
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item :label="t('options.legacyImport.preview.globalIntents')">
            {{ preview.globalIntentCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('options.legacyImport.preview.apps')">
            {{ preview.appCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('options.legacyImport.preview.appIntents')">
            {{ preview.appIntentCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('options.legacyImport.preview.hotCorners')">
            {{ preview.hotCornerCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('options.legacyImport.preview.rubEdges')">
            {{ preview.rubEdgeCount }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('options.legacyImport.preview.documentSize')">
            {{ t("options.legacyImport.bytes", { count: preview.documentSizeBytes }) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          type="warning"
          :closable="false"
          :title="t('options.legacyImport.replaceWarning')"
          show-icon
        />

        <div v-if="diagnostics.length" class="legacy-import__diagnostics">
          <h4>{{ t("options.legacyImport.warnings", { count: diagnostics.length }) }}</h4>
          <ul>
            <li v-for="(diagnostic, index) in diagnostics" :key="index">{{ diagnostic }}</li>
          </ul>
        </div>
      </template>

      <el-alert
        v-if="errorKey"
        type="error"
        :closable="false"
        :title="t(errorKey, errorSource ? { source: errorSource } : {})"
        show-icon
      />
    </div>

    <template #footer>
      <el-button :disabled="applying" @click="close">{{ t("common.cancel") }}</el-button>
      <el-button
        v-if="!preview"
        type="primary"
        :icon="DocumentChecked"
        :loading="preparing"
        :disabled="!canPrepare"
        @click="prepare"
      >
        {{ t("options.legacyImport.previewAction") }}
      </el-button>
      <el-button
        v-else
        type="primary"
        :icon="Check"
        :loading="applying"
        @click="applyImport"
      >
        {{ t("options.legacyImport.applyAction") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.legacy-import {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.legacy-import__file {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.legacy-import__file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.legacy-import__file input {
  min-width: 0;
  max-width: 100%;
  color: var(--el-text-color-regular);
}
.legacy-import__diagnostics {
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 10px 12px;
}
.legacy-import__diagnostics h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.legacy-import__diagnostics ul {
  margin: 0;
  padding-left: 20px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.55;
}
</style>
