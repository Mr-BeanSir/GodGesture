<script setup lang="ts">
/**
 * 「设置」区:通用(本机专属 + 更新)/ 参数(路径追踪)/ 显示(轨迹与提示)。
 * 本机专属设置写 machine(不同步);其余写 preferences(同步)。
 */
import { computed, onMounted, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import type { HotkeyKeyName, MachineLocalSettings } from "@godgesture/shared";
import { AppAlert, AppButton, AppSpinner } from "@godgesture/ui";
import { useConfigStore } from "../stores/config";
import { useBackend, type PlatformRuntimeStatus } from "../api/backend";
import HotkeyInput from "../components/HotkeyInput.vue";
import type { HotkeyChord } from "../components/hotkey-recorder";
import ArgbColorPicker from "../components/ArgbColorPicker.vue";

const { t } = useI18n();
const store = useConfigStore();
const backend = useBackend();

const prefs = computed(() => store.doc!.preferences);
const tracker = computed(() => store.doc!.preferences.pathTracker);
const view = computed(() => store.doc!.preferences.gestureView);
const machine = computed(() => store.machine!);

const version = ref("");
const platformStatus = ref<PlatformRuntimeStatus | null>(null);
const permissionPending = ref(false);
const permissionSettingsPending = ref(false);
const isMacOS = computed(() => platformStatus.value?.platform === "macos");
const permissionsGranted = computed(() =>
  Boolean(
    platformStatus.value?.accessibility &&
      platformStatus.value?.inputMonitoring &&
      platformStatus.value?.eventPosting &&
      platformStatus.value?.gestureEngineRunning,
  ),
);
onMounted(async () => {
  [version.value, platformStatus.value] = await Promise.all([
    backend.getAppVersion(),
    backend.platformStatus(),
  ]);
});

async function requestPermissions() {
  permissionPending.value = true;
  try {
    platformStatus.value = await backend.platformRequestPermissions();
  } finally {
    permissionPending.value = false;
  }
}

async function openPermissionSettings() {
  permissionSettingsPending.value = true;
  try {
    await backend.platformOpenPermissionSettings();
  } finally {
    permissionSettingsPending.value = false;
  }
}

const MACHINE_ERROR_KEYS: Record<string, string> = {
  uac_cancelled: "uacCancelled",
  admin_account_required: "adminAccountRequired",
  task_access_denied: "taskAccessDenied",
  task_service_unavailable: "taskServiceUnavailable",
  task_scheduler_failed: "taskSchedulerFailed",
  task_ownership_collision: "taskOwnershipCollision",
  apply_failed: "applyFailed",
  rollback_incomplete: "rollbackIncomplete",
  helper_failed: "helperFailed",
  elevation_failed: "elevationFailed",
  login_item_unavailable: "loginItemUnavailable",
  login_item_failed: "loginItemFailed",
  login_item_requires_approval: "loginItemRequiresApproval",
  login_item_not_registered: "loginItemNotRegistered",
};

const machineErrorMessage = computed(() => {
  const code = store.machineError?.code ?? store.machineStatus.code;
  const key = code ? MACHINE_ERROR_KEYS[code] : undefined;
  return t(`options.general.machineError.${key ?? "unknown"}`);
});

function updateMachine<K extends keyof MachineLocalSettings>(key: K, value: MachineLocalSettings[K]) {
  void store.updateMachineSetting(key, value).catch(() => undefined);
}

function updateMachineToggle<K extends keyof MachineLocalSettings>(key: K, event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  updateMachine(key, target.checked as MachineLocalSettings[K]);
}

const pauseKeys = computed<HotkeyKeyName[]>(() =>
  prefs.value.pauseHotkey.key ? [prefs.value.pauseHotkey.key] : [],
);
function onPauseChord(chord: HotkeyChord) {
  prefs.value.pauseHotkey.modifiers = chord.modifiers;
  prefs.value.pauseHotkey.key = chord.keys[0] ?? "";
}

type TrackerNumberKey = "initialValidMovePx" | "initialStayTimeoutMs" | "stayTimeoutMs";
function updateTrackerNumber(key: TrackerNumberKey, value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  tracker.value[key] = Math.min(max, Math.max(min, Math.round(value)));
}

function updateTrackerNumberFromInput(
  key: TrackerNumberKey,
  min: number,
  max: number,
  event: Event,
) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  updateTrackerNumber(key, target.valueAsNumber, min, max);
}

const autoStartId = useId();
const trayIconVisibleId = useId();
const autoCheckForUpdateId = useId();
const triggerRightId = useId();
const triggerMiddleId = useId();
const triggerX1Id = useId();
const triggerX2Id = useId();
const enableWindowsKeyGesturingId = useId();
const preferCursorWindowId = useId();
const disableInFullscreenId = useId();
const initialValidMovePxId = useId();
const initialStayTimeoutId = useId();
const initialStayTimeoutMsId = useId();
const stayTimeoutId = useId();
const stayTimeoutMsId = useId();
const showPathId = useId();
const showCommandNameId = useId();
const fadeOutId = useId();
const showBoundaryGuideId = useId();
</script>

<template>
  <div class="gg-page options-page">
    <header class="gg-page__header">
      <h2>{{ t("nav.options") }}</h2>
    </header>
    <div class="gg-page__scroll">
      <div class="options gg-page__stack">
    <!-- 通用 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.general.title") }}</h3>
      <AppAlert
        v-if="isMacOS"
        :variant="permissionsGranted ? 'success' : 'warning'"
        :title="
          permissionsGranted
            ? t('options.general.permissions.ready')
            : t('options.general.permissions.required')
        "
      >
        <div class="options__permission-body">
          <div class="options__permission-status">
            <span>{{ t("options.general.permissions.accessibility") }}: {{ platformStatus?.accessibility ? t("options.general.permissions.granted") : t("options.general.permissions.missing") }}</span>
            <span>{{ t("options.general.permissions.inputMonitoring") }}: {{ platformStatus?.inputMonitoring ? t("options.general.permissions.granted") : t("options.general.permissions.missing") }}</span>
            <span>{{ t("options.general.permissions.eventPosting") }}: {{ platformStatus?.eventPosting ? t("options.general.permissions.granted") : t("options.general.permissions.missing") }}</span>
          </div>
          <div v-if="!permissionsGranted" class="options__permission-actions">
            <AppButton
              variant="primary"
              size="sm"
              :loading="permissionPending"
              :loading-label="t('options.general.permissions.request')"
              @click="requestPermissions"
            >
              {{ t("options.general.permissions.request") }}
            </AppButton>
            <AppButton
              size="sm"
              :loading="permissionSettingsPending"
              :loading-label="t('options.general.permissions.openSettings')"
              @click="openPermissionSettings"
            >
              {{ t("options.general.permissions.openSettings") }}
            </AppButton>
          </div>
        </div>
      </AppAlert>
      <AppAlert
        v-if="store.machineError || !store.machineStatus.healthy"
        variant="error"
        :title="machineErrorMessage"
      />
      <div class="gg-switch-row">
        <input
          :id="autoStartId"
          class="gg-switch"
          type="checkbox"
          :checked="machine.autoStart"
          :disabled="store.machineRecovering"
          @change="updateMachineToggle('autoStart', $event)"
        />
        <label :for="autoStartId" class="options__switch-label">{{ t("options.general.autoStart") }}</label>
        <AppSpinner
          v-if="store.machinePending.autoStart"
          class="options__pending"
          size="sm"
          :aria-label="t('footer.saving')"
        />
      </div>
      <div class="gg-switch-row">
        <input
          :id="trayIconVisibleId"
          class="gg-switch"
          type="checkbox"
          :checked="machine.trayIconVisible"
          :disabled="store.machineRecovering"
          @change="updateMachineToggle('trayIconVisible', $event)"
        />
        <label :for="trayIconVisibleId" class="options__switch-label">{{ t("options.general.trayIconVisible") }}</label>
        <AppSpinner
          v-if="store.machinePending.trayIconVisible"
          class="options__pending"
          size="sm"
          :aria-label="t('footer.saving')"
        />
      </div>
      <div class="gg-switch-row">
        <input :id="autoCheckForUpdateId" v-model="prefs.autoCheckForUpdate" class="gg-switch" type="checkbox" />
        <label :for="autoCheckForUpdateId" class="options__switch-label">{{ t("options.general.autoCheckUpdate") }}</label>
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("options.general.pauseHotkey") }}</label>
        <HotkeyInput
          :modifiers="prefs.pauseHotkey.modifiers"
          :keys="pauseKeys"
          @complete="onPauseChord"
        />
      </div>
      <p class="gg-hint">{{ t("options.general.currentVersion", { version }) }}</p>
    </section>

    <!-- 参数 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.tracker.title") }}</h3>
      <fieldset class="gg-field options__trigger-buttons">
        <legend class="gg-field-label">{{ t("options.tracker.triggerButtons") }}</legend>
        <div class="options__checkboxes">
          <label :for="triggerRightId" class="options__checkbox-label">
            <input :id="triggerRightId" v-model="tracker.triggerButtons" class="gg-checkbox" type="checkbox" value="right" />
            <span>{{ t("options.tracker.triggerRight") }}</span>
          </label>
          <label :for="triggerMiddleId" class="options__checkbox-label">
            <input :id="triggerMiddleId" v-model="tracker.triggerButtons" class="gg-checkbox" type="checkbox" value="middle" />
            <span>{{ t("options.tracker.triggerMiddle") }}</span>
          </label>
          <label :for="triggerX1Id" class="options__checkbox-label">
            <input :id="triggerX1Id" v-model="tracker.triggerButtons" class="gg-checkbox" type="checkbox" value="x1" />
            <span>{{ t("options.tracker.triggerX1") }}</span>
          </label>
          <label :for="triggerX2Id" class="options__checkbox-label">
            <input :id="triggerX2Id" v-model="tracker.triggerButtons" class="gg-checkbox" type="checkbox" value="x2" />
            <span>{{ t("options.tracker.triggerX2") }}</span>
          </label>
        </div>
      </fieldset>
      <div class="gg-switch-row">
        <input :id="enableWindowsKeyGesturingId" v-model="tracker.enableWindowsKeyGesturing" class="gg-switch" type="checkbox" />
        <label :for="enableWindowsKeyGesturingId" class="options__switch-label">{{ t("options.tracker.enableWindowsKey") }}</label>
      </div>
      <div class="gg-switch-row">
        <input :id="preferCursorWindowId" v-model="tracker.preferCursorWindow" class="gg-switch" type="checkbox" />
        <label :for="preferCursorWindowId" class="options__switch-label">{{ t("options.tracker.preferCursorWindow") }}</label>
      </div>
      <div class="gg-switch-row">
        <input :id="disableInFullscreenId" v-model="tracker.disableInFullscreen" class="gg-switch" type="checkbox" />
        <label :for="disableInFullscreenId" class="options__switch-label">{{ t("options.tracker.disableInFullscreen") }}</label>
      </div>
      <div class="gg-field">
        <label :for="initialValidMovePxId" class="gg-field-label">{{ t("options.tracker.initialValidMovePx") }}</label>
        <div class="options__inline">
          <input
            :id="initialValidMovePxId"
            class="gg-number"
            type="number"
            :min="1"
            :max="50"
            :value="tracker.initialValidMovePx"
            step="1"
            @input="updateTrackerNumberFromInput('initialValidMovePx', 1, 50, $event)"
          />
          <span class="gg-unit">{{ t("options.tracker.initialValidMovePxUnit") }}</span>
        </div>
      </div>
      <div class="options__timeout-group">
        <div class="gg-field options__timeout-field">
          <div class="gg-switch-row options__timeout-toggle">
            <input :id="initialStayTimeoutId" v-model="tracker.initialStayTimeout" class="gg-switch" type="checkbox" />
            <label :for="initialStayTimeoutId" class="options__switch-label">{{ t("options.tracker.initialStayTimeout") }}</label>
          </div>
          <div class="options__inline options__timeout-value">
            <label :for="initialStayTimeoutMsId" class="gg-sr-only">{{ t("options.tracker.initialStayTimeout") }}</label>
            <input
              :id="initialStayTimeoutMsId"
              class="gg-number"
              type="number"
              :min="20"
              :max="2000"
              :step="20"
              :disabled="!tracker.initialStayTimeout"
              :value="tracker.initialStayTimeoutMs"
              @input="updateTrackerNumberFromInput('initialStayTimeoutMs', 20, 2000, $event)"
            />
            <span class="gg-unit">{{ t("options.tracker.msUnit") }}</span>
          </div>
        </div>
        <div class="gg-field options__timeout-field">
          <div class="gg-switch-row options__timeout-toggle">
            <input :id="stayTimeoutId" v-model="tracker.stayTimeout" class="gg-switch" type="checkbox" />
            <label :for="stayTimeoutId" class="options__switch-label">{{ t("options.tracker.stayTimeout") }}</label>
          </div>
          <div class="options__inline options__timeout-value">
            <label :for="stayTimeoutMsId" class="gg-sr-only">{{ t("options.tracker.stayTimeout") }}</label>
            <input
              :id="stayTimeoutMsId"
              class="gg-number"
              type="number"
              :min="50"
              :max="10000"
              :step="50"
              :disabled="!tracker.stayTimeout"
              :value="tracker.stayTimeoutMs"
              @input="updateTrackerNumberFromInput('stayTimeoutMs', 50, 10000, $event)"
            />
            <span class="gg-unit">{{ t("options.tracker.msUnit") }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 显示 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.view.title") }}</h3>
      <div class="gg-switch-row">
        <input :id="showPathId" v-model="view.showPath" class="gg-switch" type="checkbox" />
        <label :for="showPathId" class="options__switch-label">{{ t("options.view.showPath") }}</label>
      </div>
      <div class="gg-switch-row">
        <input
          :id="showBoundaryGuideId"
          v-model="view.showBoundaryGuide"
          class="gg-switch"
          type="checkbox"
        />
        <label :for="showBoundaryGuideId" class="options__switch-label">
          {{ t("options.view.showBoundaryGuide") }}
        </label>
      </div>
      <div class="gg-switch-row">
        <input :id="showCommandNameId" v-model="view.showCommandName" class="gg-switch" type="checkbox" />
        <label :for="showCommandNameId" class="options__switch-label">{{ t("options.view.showCommandName") }}</label>
      </div>
      <div class="gg-switch-row">
        <input :id="fadeOutId" v-model="view.fadeOut" class="gg-switch" type="checkbox" />
        <label :for="fadeOutId" class="options__switch-label">{{ t("options.view.fadeOut") }}</label>
      </div>
      <div class="options__color-row">
        <span>{{ t("options.view.rightColor") }}</span>
        <ArgbColorPicker v-model="view.rightButtonPathColor" />
      </div>
      <div class="options__color-row">
        <span>{{ t("options.view.middleColor") }}</span>
        <ArgbColorPicker v-model="view.middleButtonPathColor" />
      </div>
      <div class="options__color-row">
        <span>{{ t("options.view.xColor") }}</span>
        <ArgbColorPicker v-model="view.xButtonPathColor" />
      </div>
      <div class="options__color-row">
        <span>{{ t("options.view.unrecognizedColor") }}</span>
        <ArgbColorPicker v-model="view.unrecognizedPathColor" />
      </div>
    </section>

      </div>
    </div>
  </div>
</template>

<style scoped>
.options {
  width: min(100%, 760px);
}
.options__inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.options__inline .gg-number {
  max-width: 160px;
}
.options__timeout-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.options__timeout-field {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 142px;
  column-gap: 10px;
  row-gap: 0;
  min-height: 32px;
  align-items: center;
}
.options__timeout-toggle {
  display: grid;
  grid-column: 1 / 3;
  grid-template-columns: 38px minmax(0, 1fr);
  column-gap: 10px;
  min-width: 0;
  min-height: 32px;
  align-items: center;
}
.options__timeout-toggle .options__switch-label {
  min-width: 0;
  min-height: 32px;
}
.options__timeout-value {
  grid-column: 3;
  justify-content: flex-end;
}
.options__timeout-value .gg-number {
  width: 102px;
  max-width: 102px;
  flex: 0 0 102px;
}
.options__color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 360px;
}
.options__pending {
  color: var(--gg-primary);
}
.options__permission-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.options__permission-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--gg-text-muted);
  font-size: 12px;
}
.options__permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.options__switch-label,
.options__checkbox-label {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  color: var(--gg-text);
}
.options__trigger-buttons {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.options__checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
}
.options__checkbox-label {
  gap: 8px;
}
</style>
