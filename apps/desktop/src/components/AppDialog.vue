<script setup lang="ts">
/**
 * 添加 / 编辑应用条目对话框。
 * 应用绑定机器无关:Windows 以 exe 文件名匹配(可选精确路径),macOS 以 Bundle ID 匹配。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { Aim, Loading, UploadFilled } from "@element-plus/icons-vue";
import type { AppEntry } from "@godgesture/shared";
import {
  BackendError,
  useBackend,
  type AppFileDropEvent,
  type PickedWindow,
} from "../api/backend";
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
const resolvingDrop = ref(false);
const dropActive = ref(false);
const platform = ref<"windows" | "macos" | "unsupported">("windows");
const isMacOS = computed(() => platform.value === "macos");

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
    else dropActive.value = false;
  },
);

const hasNoBinding = computed(() => !exeName.value.trim() && !bundleId.value.trim());

function applyPickedWindow(win: PickedWindow) {
  if (win.exeName) exeName.value = win.exeName;
  if (win.exePath) exactPath.value = win.exePath;
  if (win.aumid) aumid.value = win.aumid;
  if (win.bundleId) bundleId.value = win.bundleId;
  if (!name.value.trim()) name.value = win.appName;
}

async function pickWindow(event: PointerEvent) {
  if (picking.value || resolvingDrop.value) return;
  const target = event.currentTarget as HTMLElement | null;
  try {
    target?.setPointerCapture(event.pointerId);
  } catch {
    // WebView pointer capture is best-effort; native button-state polling still cancels safely.
  }
  picking.value = true;
  document.documentElement.classList.add("gg-window-picking");
  try {
    const win = await backend.pickWindow();
    if (win) applyPickedWindow(win);
  } finally {
    picking.value = false;
    document.documentElement.classList.remove("gg-window-picking");
    try {
      if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser on pointer-up.
    }
  }
}

const APP_FILE_ERROR_KEYS: Record<string, string> = {
  unsupported_app_file: "unsupported",
  app_file_unavailable: "unavailable",
  shortcut_resolution_failed: "shortcut",
};

async function resolveDroppedApp(path: string) {
  if (resolvingDrop.value || picking.value) return;
  resolvingDrop.value = true;
  try {
    applyPickedWindow(await backend.resolveAppFile(path));
  } catch (error) {
    const code = error instanceof BackendError ? error.code : "unknown";
    const key = APP_FILE_ERROR_KEYS[code] ?? "unknown";
    ElMessage.error(t(`appDialog.fileError.${key}`));
  } finally {
    resolvingDrop.value = false;
  }
}

function onAppFileDrop(event: AppFileDropEvent) {
  if (!visible.value) {
    dropActive.value = false;
    return;
  }
  if (event.type === "enter" || event.type === "over") {
    dropActive.value = true;
  } else {
    dropActive.value = false;
  }
  if (event.type === "drop" && event.paths[0]) {
    void resolveDroppedApp(event.paths[0]);
  }
}

let unlistenDrop: (() => void) | null = null;
let unmounted = false;

onMounted(() => {
  void backend
    .platformStatus()
    .then((status) => {
      if (!unmounted) platform.value = status.platform;
    })
    .catch(() => undefined);
  void backend
    .onAppFileDrop(onAppFileDrop)
    .then((unlisten) => {
      if (unmounted) unlisten();
      else unlistenDrop = unlisten;
    })
    .catch(() => {
      if (!unmounted) ElMessage.error(t("appDialog.dropUnavailable"));
    });
});

onUnmounted(() => {
  unmounted = true;
  unlistenDrop?.();
  document.documentElement.classList.remove("gg-window-picking");
});

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
    :close-on-press-escape="!picking"
  >
    <div class="app-dialog">
      <p class="gg-hint">{{ t("appDialog.bindingHint") }}</p>

      <div class="gg-field">
        <label class="gg-field-label">{{ t("appDialog.name") }}</label>
        <el-input v-model="name" :placeholder="t('appDialog.namePlaceholder')" />
      </div>

      <div v-if="!isMacOS" class="app-dialog__section" :class="{ 'is-drop-active': dropActive }">
        <div class="app-dialog__section-heading">
          <h4 class="app-dialog__section-title">{{ t("appDialog.windowsSection") }}</h4>
          <el-tooltip :content="t('appDialog.dropFile')" placement="top">
            <el-icon
              class="app-dialog__drop-icon"
              :class="{ 'is-active': dropActive, 'is-loading': resolvingDrop }"
            >
              <Loading v-if="resolvingDrop" />
              <UploadFilled v-else />
            </el-icon>
          </el-tooltip>
        </div>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("appDialog.exeName") }}</label>
          <div class="app-dialog__inline">
            <el-input v-model="exeName" :placeholder="t('appDialog.exeNamePlaceholder')" />
            <el-tooltip :content="t('appDialog.pickWindow')" placement="top">
              <el-button
                class="app-dialog__pick"
                :class="{ 'is-picking': picking }"
                :icon="picking ? Loading : Aim"
                :disabled="resolvingDrop"
                :aria-label="t('appDialog.pickWindow')"
                @pointerdown.prevent="pickWindow"
              />
            </el-tooltip>
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

      <div class="app-dialog__section" :class="{ 'is-drop-active': isMacOS && dropActive }">
        <div class="app-dialog__section-heading">
          <h4 class="app-dialog__section-title">{{ t("appDialog.macSection") }}</h4>
          <el-tooltip v-if="isMacOS" :content="t('appDialog.dropMacApp')" placement="top">
            <el-icon
              class="app-dialog__drop-icon"
              :class="{ 'is-active': dropActive, 'is-loading': resolvingDrop }"
            >
              <Loading v-if="resolvingDrop" />
              <UploadFilled v-else />
            </el-icon>
          </el-tooltip>
        </div>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("appDialog.bundleId") }}</label>
          <div class="app-dialog__inline">
            <el-input v-model="bundleId" :placeholder="t('appDialog.bundleIdPlaceholder')" />
            <el-tooltip v-if="isMacOS" :content="t('appDialog.pickWindow')" placement="top">
              <el-button
                class="app-dialog__pick"
                :class="{ 'is-picking': picking }"
                :icon="picking ? Loading : Aim"
                :disabled="resolvingDrop"
                :aria-label="t('appDialog.pickWindow')"
                @pointerdown.prevent="pickWindow"
              />
            </el-tooltip>
          </div>
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
  transition: border-color 120ms ease, background-color 120ms ease;
}
.app-dialog__section.is-drop-active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.app-dialog__section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.app-dialog__section-title {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.app-dialog__drop-icon {
  width: 18px;
  height: 18px;
  color: var(--el-text-color-placeholder);
}
.app-dialog__drop-icon.is-active {
  color: var(--el-color-primary);
}
.app-dialog__drop-icon.is-loading {
  animation: app-dialog-spin 1s linear infinite;
}
.app-dialog__inline {
  display: flex;
  gap: 8px;
}
.app-dialog__inline .el-input {
  flex: 1;
}
.app-dialog__pick.is-picking :deep(.el-icon) {
  animation: app-dialog-spin 1s linear infinite;
}
:global(html.gg-window-picking),
:global(html.gg-window-picking *) {
  cursor: crosshair !important;
  user-select: none;
}
@keyframes app-dialog-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
