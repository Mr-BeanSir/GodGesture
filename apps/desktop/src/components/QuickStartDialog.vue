<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Aim,
  ArrowLeft,
  ArrowRight,
  Collection,
  UploadFilled,
} from "@element-plus/icons-vue";
import type { GestureIntent } from "@godgesture/shared";
import { useBackend, type PlatformRuntimeStatus } from "../api/backend";
import MnemonicText from "./MnemonicText.vue";

const props = defineProps<{
  modelValue: boolean;
  intents: GestureIntent[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  navigate: [destination: "gestures" | "templates"];
  "open-legacy-import": [];
}>();

const { t } = useI18n();
const backend = useBackend();
const activeStep = ref(0);
const platformStatus = ref<PlatformRuntimeStatus | null>(null);
const statusPending = ref(false);
const permissionPending = ref(false);
const examples = computed(() => props.intents.slice(0, 3));
const isMacOS = computed(() => platformStatus.value?.platform === "macos");
const permissionsGranted = computed(() =>
  Boolean(
    platformStatus.value?.accessibility &&
      platformStatus.value?.inputMonitoring &&
      platformStatus.value?.eventPosting,
  ),
);
const ready = computed(() =>
  Boolean(platformStatus.value?.gestureEngineRunning && (!isMacOS.value || permissionsGranted.value)),
);
const readinessType = computed(() => {
  if (!platformStatus.value || statusPending.value) return "info";
  if (ready.value) return "success";
  return platformStatus.value.platform === "unsupported" ? "error" : "warning";
});
const readinessTitle = computed(() => {
  if (statusPending.value) return t("quickGuide.ready.checking");
  if (!platformStatus.value) return t("quickGuide.ready.unavailable");
  if (platformStatus.value.platform === "unsupported") {
    return t("quickGuide.ready.unsupported");
  }
  if (ready.value) return t("quickGuide.ready.available");
  return isMacOS.value
    ? t("quickGuide.ready.permissionsRequired")
    : t("quickGuide.ready.engineUnavailable");
});

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return;
    activeStep.value = 0;
    void refreshStatus();
  },
  { immediate: true },
);

async function refreshStatus() {
  statusPending.value = true;
  try {
    platformStatus.value = await backend.platformStatus();
  } catch {
    platformStatus.value = null;
  } finally {
    statusPending.value = false;
  }
}

async function requestPermissions() {
  permissionPending.value = true;
  try {
    platformStatus.value = await backend.platformRequestPermissions();
  } catch {
    platformStatus.value = null;
  } finally {
    permissionPending.value = false;
  }
}

async function openPermissionSettings() {
  await backend.platformOpenPermissionSettings();
}

function close() {
  emit("update:modelValue", false);
}

function navigate(destination: "gestures" | "templates") {
  emit("navigate", destination);
}

function openLegacyImport() {
  emit("open-legacy-import");
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="quick-guide"
    :title="t('quickGuide.title')"
    width="min(620px, calc(100vw - 32px))"
    align-center
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-steps :active="activeStep" align-center finish-status="success">
      <el-step :title="t('quickGuide.steps.ready')" />
      <el-step :title="t('quickGuide.steps.try')" />
      <el-step :title="t('quickGuide.steps.personalize')" />
    </el-steps>

    <div class="quick-guide__content">
      <section v-if="activeStep === 0" class="quick-guide__step">
        <h3>{{ t("quickGuide.ready.title") }}</h3>
        <p class="gg-hint">{{ t("quickGuide.ready.body") }}</p>
        <el-alert
          :type="readinessType"
          show-icon
          :closable="false"
          :title="readinessTitle"
        />

        <dl v-if="isMacOS && platformStatus" class="quick-guide__permissions">
          <div>
            <dt>{{ t("options.general.permissions.accessibility") }}</dt>
            <dd>
              <el-tag :type="platformStatus.accessibility ? 'success' : 'warning'" size="small">
                {{ t(platformStatus.accessibility ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </el-tag>
            </dd>
          </div>
          <div>
            <dt>{{ t("options.general.permissions.inputMonitoring") }}</dt>
            <dd>
              <el-tag :type="platformStatus.inputMonitoring ? 'success' : 'warning'" size="small">
                {{ t(platformStatus.inputMonitoring ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </el-tag>
            </dd>
          </div>
          <div>
            <dt>{{ t("options.general.permissions.eventPosting") }}</dt>
            <dd>
              <el-tag :type="platformStatus.eventPosting ? 'success' : 'warning'" size="small">
                {{ t(platformStatus.eventPosting ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </el-tag>
            </dd>
          </div>
        </dl>

        <div v-if="isMacOS && !ready" class="quick-guide__permission-actions">
          <el-button type="primary" :loading="permissionPending" @click="requestPermissions">
            {{ t("options.general.permissions.request") }}
          </el-button>
          <el-button @click="openPermissionSettings">
            {{ t("options.general.permissions.openSettings") }}
          </el-button>
        </div>
      </section>

      <section v-else-if="activeStep === 1" class="quick-guide__step">
        <h3>{{ t("quickGuide.try.title") }}</h3>
        <p class="gg-hint">{{ t("quickGuide.try.body") }}</p>
        <div v-if="examples.length" class="quick-guide__examples">
          <div v-for="intent in examples" :key="intent.id" class="quick-guide__example">
            <MnemonicText :gesture="intent.gesture" />
            <span>{{ intent.name }}</span>
          </div>
        </div>
        <el-empty v-else :image-size="48" :description="t('quickGuide.try.empty')" />
      </section>

      <section v-else class="quick-guide__step">
        <h3>{{ t("quickGuide.personalize.title") }}</h3>
        <p class="gg-hint">{{ t("quickGuide.personalize.body") }}</p>
        <div class="quick-guide__destinations">
          <div class="quick-guide__destination">
            <div>
              <strong>{{ t("quickGuide.personalize.gestures") }}</strong>
              <span>{{ t("quickGuide.personalize.gesturesDesc") }}</span>
            </div>
            <el-button :icon="Aim" @click="navigate('gestures')">
              {{ t("quickGuide.personalize.open") }}
            </el-button>
          </div>
          <div class="quick-guide__destination">
            <div>
              <strong>{{ t("quickGuide.personalize.templates") }}</strong>
              <span>{{ t("quickGuide.personalize.templatesDesc") }}</span>
            </div>
            <el-button :icon="Collection" @click="navigate('templates')">
              {{ t("quickGuide.personalize.open") }}
            </el-button>
          </div>
          <div class="quick-guide__destination">
            <div>
              <strong>{{ t("quickGuide.personalize.legacyImport") }}</strong>
              <span>{{ t("quickGuide.personalize.legacyImportDesc") }}</span>
            </div>
            <el-button :icon="UploadFilled" @click="openLegacyImport">
              {{ t("quickGuide.personalize.open") }}
            </el-button>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="quick-guide__footer">
        <div>
          <el-button v-if="activeStep > 0" :icon="ArrowLeft" @click="activeStep -= 1">
            {{ t("quickGuide.back") }}
          </el-button>
        </div>
        <div>
          <el-button
            v-if="activeStep < 2"
            type="primary"
            @click="activeStep += 1"
          >
            {{ t("quickGuide.next") }}
            <el-icon class="el-icon--right"><ArrowRight /></el-icon>
          </el-button>
          <el-button v-else type="primary" @click="close">
            {{ t("quickGuide.finish") }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.quick-guide__content {
  min-height: 300px;
  padding-top: 24px;
}
.quick-guide__step {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.quick-guide__step h3 {
  margin: 0;
  font-size: 16px;
}
.quick-guide__permissions {
  margin: 0;
  border-top: 1px solid var(--el-border-color-lighter);
}
.quick-guide__permissions > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.quick-guide__permissions dt {
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.quick-guide__permissions dd {
  margin: 0;
}
.quick-guide__permission-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.quick-guide__examples {
  border-top: 1px solid var(--el-border-color-lighter);
}
.quick-guide__example {
  min-height: 48px;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.quick-guide__destinations {
  border-top: 1px solid var(--el-border-color-lighter);
}
.quick-guide__destination {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.quick-guide__destination > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-guide__destination strong {
  font-size: 13px;
}
.quick-guide__destination span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.quick-guide__destination .el-button {
  flex: none;
}
.quick-guide__footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
@media (max-width: 560px) {
  .quick-guide__content {
    min-height: 330px;
  }
  .quick-guide__example {
    grid-template-columns: 125px minmax(0, 1fr);
  }
  .quick-guide__destination {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
  }
}
</style>
