<script setup lang="ts">
/**
 * 添加 / 编辑应用条目对话框。
 * 应用绑定机器无关:Windows 以 exe 文件名匹配(可选精确路径),macOS 以 Bundle ID 匹配。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Crosshair, Upload } from "lucide-vue-next";
import { AppAlert, AppButton, AppDialog as SharedAppDialog, AppSpinner, pushToast } from "@godgesture/ui";
import { DEFAULT_APP_GROUP_ID, type AppEntry } from "@godgesture/shared";
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
  { immediate: true },
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
    pushToast({ kind: "error", message: t(`appDialog.fileError.${key}`) });
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
      if (!unmounted) pushToast({ kind: "error", message: t("appDialog.dropUnavailable") });
    });
});

onUnmounted(() => {
  unmounted = true;
  unlistenDrop?.();
  document.documentElement.classList.remove("gg-window-picking");
});

function onSave() {
  if (!name.value.trim()) {
    pushToast({ kind: "warning", message: t("appDialog.nameRequired") });
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
    groupId: props.app?.groupId ?? DEFAULT_APP_GROUP_ID,
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
  <SharedAppDialog
    :open="visible"
    :title="isEdit ? t('appDialog.editTitle') : t('appDialog.addTitle')"
    :close-label="t('common.cancel')"
    :busy="picking || resolvingDrop"
    initial-focus="#app-name"
    @close="visible = false"
  >
    <form class="app-dialog" @submit.prevent="onSave">
      <p class="gg-hint">{{ t("appDialog.bindingHint") }}</p>

      <div class="gg-field">
        <label class="gg-field-label" for="app-name">{{ t("appDialog.name") }}</label>
        <input id="app-name" v-model="name" class="gg-input" :placeholder="t('appDialog.namePlaceholder')" />
      </div>

      <section
        v-if="!isMacOS"
        class="app-dialog__section"
        :class="{ 'is-drop-active': dropActive }"
        aria-labelledby="app-windows-heading"
      >
        <div class="app-dialog__section-heading">
          <h4 id="app-windows-heading" class="app-dialog__section-title">{{ t("appDialog.windowsSection") }}</h4>
          <AppSpinner
            v-if="resolvingDrop"
            class="app-dialog__drop-icon"
            size="sm"
            :aria-label="t('appDialog.dropFile')"
            :title="t('appDialog.dropFile')"
          />
          <Upload
            v-else
            class="app-dialog__drop-icon"
            :class="{ 'is-active': dropActive }"
            :aria-label="t('appDialog.dropFile')"
            :title="t('appDialog.dropFile')"
          />
        </div>
        <div class="gg-field">
          <label class="gg-field-label" for="app-exe-name">{{ t("appDialog.exeName") }}</label>
          <div class="app-dialog__inline">
            <input id="app-exe-name" v-model="exeName" class="gg-input" :placeholder="t('appDialog.exeNamePlaceholder')" />
            <button
              type="button"
              class="gg-icon-button app-dialog__pick"
              :class="{ 'is-picking': picking }"
              :disabled="resolvingDrop"
              :aria-busy="picking || undefined"
              :aria-label="t('appDialog.pickWindow')"
              :title="t('appDialog.pickWindow')"
              @pointerdown.prevent="pickWindow"
            >
              <AppSpinner v-if="picking" size="sm" aria-hidden="true" />
              <Crosshair v-else aria-hidden="true" />
            </button>
          </div>
          <p v-if="!backend.isTauri" class="gg-hint">{{ t("appDialog.pickWindowHint") }}</p>
        </div>
        <label class="gg-switch-row" for="app-match-exact-path">
          <input id="app-match-exact-path" v-model="matchByExactPath" class="gg-switch" type="checkbox" />
          <span>{{ t("appDialog.matchByExactPath") }}</span>
        </label>
        <div v-if="matchByExactPath" class="gg-field">
          <label class="gg-field-label" for="app-exact-path">{{ t("appDialog.exactPath") }}</label>
          <input id="app-exact-path" v-model="exactPath" class="gg-input" :placeholder="t('appDialog.exactPathPlaceholder')" />
        </div>
      </section>

      <section
        class="app-dialog__section"
        :class="{ 'is-drop-active': isMacOS && dropActive }"
        aria-labelledby="app-macos-heading"
      >
        <div class="app-dialog__section-heading">
          <h4 id="app-macos-heading" class="app-dialog__section-title">{{ t("appDialog.macSection") }}</h4>
          <AppSpinner
            v-if="isMacOS && resolvingDrop"
            class="app-dialog__drop-icon"
            size="sm"
            :aria-label="t('appDialog.dropMacApp')"
            :title="t('appDialog.dropMacApp')"
          />
          <Upload
            v-else-if="isMacOS"
            class="app-dialog__drop-icon"
            :class="{ 'is-active': dropActive }"
            :aria-label="t('appDialog.dropMacApp')"
            :title="t('appDialog.dropMacApp')"
          />
        </div>
        <div class="gg-field">
          <label class="gg-field-label" for="app-bundle-id">{{ t("appDialog.bundleId") }}</label>
          <div class="app-dialog__inline">
            <input id="app-bundle-id" v-model="bundleId" class="gg-input" :placeholder="t('appDialog.bundleIdPlaceholder')" />
            <button
              v-if="isMacOS"
              type="button"
              class="gg-icon-button app-dialog__pick"
              :class="{ 'is-picking': picking }"
              :disabled="resolvingDrop"
              :aria-busy="picking || undefined"
              :aria-label="t('appDialog.pickWindow')"
              :title="t('appDialog.pickWindow')"
              @pointerdown.prevent="pickWindow"
            >
              <AppSpinner v-if="picking" size="sm" aria-hidden="true" />
              <Crosshair v-else aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <AppAlert
        v-if="hasNoBinding"
        variant="info"
        :title="t('appDialog.noBindingWarning')"
      />
    </form>

    <template #footer>
      <AppButton :disabled="picking || resolvingDrop" @click="visible = false">
        {{ t("common.cancel") }}
      </AppButton>
      <AppButton variant="primary" :loading="picking || resolvingDrop" @click="onSave">
        {{ t("common.ok") }}
      </AppButton>
    </template>
  </SharedAppDialog>
</template>

<style scoped>
.app-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.app-dialog__section {
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.app-dialog__section.is-drop-active {
  border-color: var(--gg-primary);
  background: var(--gg-primary-soft);
}
.app-dialog__section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.app-dialog__section-title {
  margin: 0;
  font-size: 13px;
  color: var(--gg-text-muted);
}
.app-dialog__drop-icon {
  width: 18px;
  height: 18px;
  color: var(--gg-text-subtle);
}
.app-dialog__drop-icon.is-active {
  color: var(--gg-primary);
}
.app-dialog__inline {
  display: flex;
  gap: 8px;
}
.app-dialog__inline .gg-input {
  flex: 1;
}
:global(html.gg-window-picking),
:global(html.gg-window-picking *) {
  cursor: crosshair !important;
  user-select: none;
}
</style>
