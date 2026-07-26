<script setup lang="ts">
/**
 * 添加 / 编辑应用条目对话框。
 * 应用绑定机器无关:Windows 以 exe 文件名匹配(可选精确路径),macOS 以 Bundle ID 匹配。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { AppEntry } from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { newId } from "../utils/id";

const props = defineProps<{
  modelValue: boolean;
  /** null = 新增 */
  app: AppEntry | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "save", app: AppEntry): void;
}>();

const { t } = useI18n();
const backend = useBackend();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const isEdit = computed(() => props.app !== null);
const picking = ref(false);

// 本地编辑态(避免直接改动配置文档)
const name = ref("");
const exeName = ref("");
const aumid = ref<string | undefined>(undefined);
const exactPath = ref("");
const matchByExactPath = ref(false);
const bundleId = ref("");

function reset() {
  const a = props.app;
  name.value = a?.name ?? "";
  exeName.value = a?.windows?.exeName ?? "";
  aumid.value = a?.windows?.aumid;
  exactPath.value = a?.windows?.exactPath ?? "";
  matchByExactPath.value = a?.windows?.matchByExactPath ?? false;
  bundleId.value = a?.mac?.bundleId ?? "";
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

const hasNoBinding = computed(() => !exeName.value.trim() && !bundleId.value.trim());

async function pickWindow() {
  picking.value = true;
  try {
    const win = await backend.pickWindow();
    if (win) {
      exeName.value = win.exeName;
      exactPath.value = win.exePath;
      if (!name.value.trim()) name.value = win.appName;
    }
  } finally {
    picking.value = false;
  }
}

function onSave() {
  if (!name.value.trim()) {
    ElMessage.warning(t("appDialog.nameRequired"));
    return;
  }
  const windows = exeName.value.trim()
    ? {
        exeName: exeName.value.trim().toLowerCase(),
        aumid: aumid.value,
        exactPath: exactPath.value.trim() || undefined,
        matchByExactPath: matchByExactPath.value,
      }
    : undefined;
  const mac = bundleId.value.trim() ? { bundleId: bundleId.value.trim() } : undefined;

  const result: AppEntry = {
    id: props.app?.id ?? newId(),
    name: name.value.trim(),
    windows,
    mac,
    gesturingEnabled: props.app?.gesturingEnabled ?? true,
    inheritGlobalGestures: props.app?.inheritGlobalGestures ?? true,
    intents: props.app?.intents ?? [],
    order: props.app?.order ?? 0,
  };
  emit("save", result);
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? t('appDialog.editTitle') : t('appDialog.addTitle')"
    width="520px"
    align-center
    append-to-body
  >
    <div class="app-dialog">
      <p class="gg-hint">{{ t("appDialog.bindingHint") }}</p>

      <div class="gg-field">
        <label class="gg-field-label">{{ t("appDialog.name") }}</label>
        <el-input v-model="name" :placeholder="t('appDialog.namePlaceholder')" />
      </div>

      <div class="app-dialog__section">
        <h4 class="app-dialog__section-title">{{ t("appDialog.windowsSection") }}</h4>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("appDialog.exeName") }}</label>
          <div class="app-dialog__inline">
            <el-input v-model="exeName" :placeholder="t('appDialog.exeNamePlaceholder')" />
            <el-button :loading="picking" @click="pickWindow">
              {{ t("appDialog.pickWindow") }}
            </el-button>
          </div>
          <p v-if="!backend.isTauri" class="gg-hint">{{ t("appDialog.pickWindowHint") }}</p>
        </div>
        <div class="gg-switch-row">
          <el-switch v-model="matchByExactPath" />
          <span>{{ t("appDialog.matchByExactPath") }}</span>
        </div>
        <div v-if="matchByExactPath" class="gg-field">
          <label class="gg-field-label">{{ t("appDialog.exactPath") }}</label>
          <el-input v-model="exactPath" :placeholder="t('appDialog.exactPathPlaceholder')" />
        </div>
      </div>

      <div class="app-dialog__section">
        <h4 class="app-dialog__section-title">{{ t("appDialog.macSection") }}</h4>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("appDialog.bundleId") }}</label>
          <el-input v-model="bundleId" :placeholder="t('appDialog.bundleIdPlaceholder')" />
        </div>
      </div>

      <el-alert
        v-if="hasNoBinding"
        type="info"
        :closable="false"
        show-icon
        :title="t('appDialog.noBindingWarning')"
      />
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" @click="onSave">{{ t("common.ok") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.app-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.app-dialog__section {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.app-dialog__section-title {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.app-dialog__inline {
  display: flex;
  gap: 8px;
}
.app-dialog__inline .el-input {
  flex: 1;
}
</style>
