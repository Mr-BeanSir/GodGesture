<script setup lang="ts">
/**
 * 「选项」区:通用(本机专属 + 更新)/ 参数(路径追踪)/ 显示(轨迹与提示)。
 * 本机专属设置写 machine(不同步);其余写 preferences(同步)。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { InfoFilled } from "@element-plus/icons-vue";
import type { HotkeyKeyName, HotkeyModifier } from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { useBackend } from "../api/backend";
import HotkeyInput from "../components/HotkeyInput.vue";
import ArgbColorPicker from "../components/ArgbColorPicker.vue";

const { t } = useI18n();
const store = useConfigStore();
const backend = useBackend();

const prefs = computed(() => store.doc!.preferences);
const tracker = computed(() => store.doc!.preferences.pathTracker);
const view = computed(() => store.doc!.preferences.gestureView);
const machine = computed(() => store.machine!);

const version = ref("");
onMounted(async () => {
  version.value = await backend.getAppVersion();
});

const pauseKeys = computed<HotkeyKeyName[]>(() =>
  prefs.value.pauseHotkey.key ? [prefs.value.pauseHotkey.key] : [],
);
function onPauseModifiers(mods: HotkeyModifier[]) {
  prefs.value.pauseHotkey.modifiers = mods;
}
function onPauseKeys(keys: HotkeyKeyName[]) {
  prefs.value.pauseHotkey.key = keys[0] ?? "";
}

type TrackerNumberKey = "initialValidMovePx" | "initialStayTimeoutMs" | "stayTimeoutMs";
function updateTrackerNumber(key: TrackerNumberKey, value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  tracker.value[key] = Math.min(max, Math.max(min, Math.round(value)));
}
</script>

<template>
  <div class="options">
    <!-- 通用 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.general.title") }}</h3>
      <div class="gg-switch-row">
        <el-switch v-model="machine.autoStart" />
        <span>{{ t("options.general.autoStart") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="machine.runAsAdmin" />
        <span>{{ t("options.general.runAsAdmin") }}</span>
        <el-tooltip :content="t('options.general.runAsAdminHint')" placement="top">
          <el-icon class="gg-info"><InfoFilled /></el-icon>
        </el-tooltip>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="machine.trayIconVisible" />
        <span>{{ t("options.general.trayIconVisible") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="prefs.autoCheckForUpdate" />
        <span>{{ t("options.general.autoCheckUpdate") }}</span>
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("options.general.pauseHotkey") }}</label>
        <HotkeyInput
          :modifiers="prefs.pauseHotkey.modifiers"
          :keys="pauseKeys"
          @update:modifiers="onPauseModifiers"
          @update:keys="onPauseKeys"
        />
      </div>
      <p class="gg-hint">{{ t("options.general.currentVersion", { version }) }}</p>
    </section>

    <!-- 参数 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.tracker.title") }}</h3>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("options.tracker.triggerButtons") }}</label>
        <el-checkbox-group v-model="tracker.triggerButtons">
          <el-checkbox value="right">{{ t("options.tracker.triggerRight") }}</el-checkbox>
          <el-checkbox value="middle">{{ t("options.tracker.triggerMiddle") }}</el-checkbox>
          <el-checkbox value="x1">{{ t("options.tracker.triggerX1") }}</el-checkbox>
          <el-checkbox value="x2">{{ t("options.tracker.triggerX2") }}</el-checkbox>
        </el-checkbox-group>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="tracker.enable8Directions" />
        <span>{{ t("options.tracker.enable8Directions") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="tracker.enableWindowsKeyGesturing" />
        <span>{{ t("options.tracker.enableWindowsKey") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="tracker.preferCursorWindow" />
        <span>{{ t("options.tracker.preferCursorWindow") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="tracker.disableInFullscreen" />
        <span>{{ t("options.tracker.disableInFullscreen") }}</span>
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("options.tracker.initialValidMovePx") }}</label>
        <div class="options__inline">
          <el-input-number
            :model-value="tracker.initialValidMovePx"
            :min="1"
            :max="50"
            @update:model-value="updateTrackerNumber('initialValidMovePx', $event, 1, 50)"
          />
          <span class="gg-unit">{{ t("options.tracker.initialValidMovePxUnit") }}</span>
        </div>
      </div>
      <div class="gg-field">
        <div class="gg-switch-row">
          <el-switch v-model="tracker.initialStayTimeout" />
          <span>{{ t("options.tracker.initialStayTimeout") }}</span>
        </div>
        <div class="options__inline options__indent">
          <el-input-number
            :model-value="tracker.initialStayTimeoutMs"
            :min="20"
            :max="2000"
            :step="20"
            :disabled="!tracker.initialStayTimeout"
            @update:model-value="updateTrackerNumber('initialStayTimeoutMs', $event, 20, 2000)"
          />
          <span class="gg-unit">{{ t("options.tracker.msUnit") }}</span>
        </div>
      </div>
      <div class="gg-field">
        <div class="gg-switch-row">
          <el-switch v-model="tracker.stayTimeout" />
          <span>{{ t("options.tracker.stayTimeout") }}</span>
        </div>
        <div class="options__inline options__indent">
          <el-input-number
            :model-value="tracker.stayTimeoutMs"
            :min="50"
            :max="10000"
            :step="50"
            :disabled="!tracker.stayTimeout"
            @update:model-value="updateTrackerNumber('stayTimeoutMs', $event, 50, 10000)"
          />
          <span class="gg-unit">{{ t("options.tracker.msUnit") }}</span>
        </div>
      </div>
    </section>

    <!-- 显示 -->
    <section class="gg-section">
      <h3 class="gg-section-title">{{ t("options.view.title") }}</h3>
      <div class="gg-switch-row">
        <el-switch v-model="view.showPath" />
        <span>{{ t("options.view.showPath") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="view.showCommandName" />
        <span>{{ t("options.view.showCommandName") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="view.fadeOut" />
        <span>{{ t("options.view.fadeOut") }}</span>
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
</template>

<style scoped>
.options {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 640px;
}
.options__inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.options__indent {
  margin-top: 8px;
  padding-left: 42px;
}
.options__color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 360px;
}
</style>
