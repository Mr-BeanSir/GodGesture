<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ArrowLeft,
  ArrowRight,
  Crosshair,
  LibraryBig,
} from "lucide-vue-next";
import { AppAlert, AppButton, AppDialog, AppSpinner } from "@godgesture/ui";
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
}>();

const { t } = useI18n();
const backend = useBackend();
const activeStep = ref(0);
const platformStatus = ref<PlatformRuntimeStatus | null>(null);
const statusPending = ref(false);
const permissionPending = ref(false);
const settingsPending = ref(false);
const examples = computed(() => props.intents.slice(0, 3));
const dialogBusy = computed(() =>
  statusPending.value || permissionPending.value || settingsPending.value,
);
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
  settingsPending.value = true;
  try {
    await backend.platformOpenPermissionSettings();
  } finally {
    settingsPending.value = false;
  }
}

function close() {
  emit("update:modelValue", false);
}

function navigate(destination: "gestures" | "templates") {
  emit("navigate", destination);
}

</script>

<template>
  <AppDialog
    :open="modelValue"
    class="quick-guide"
    :title="t('quickGuide.title')"
    :close-label="t('common.cancel')"
    :busy="dialogBusy"
    @close="close"
  >
    <ol class="quick-guide__steps" :aria-label="t('quickGuide.title')">
      <li
        v-for="(step, index) in [t('quickGuide.steps.ready'), t('quickGuide.steps.try'), t('quickGuide.steps.personalize')]"
        :key="step"
        :class="{ 'is-active': index === activeStep, 'is-complete': index < activeStep }"
      >
        <span class="quick-guide__step-number" aria-hidden="true">{{ index + 1 }}</span>
        <span>{{ step }}</span>
      </li>
    </ol>

    <div class="quick-guide__content">
      <section v-if="activeStep === 0" class="quick-guide__step">
        <h3>{{ t("quickGuide.ready.title") }}</h3>
        <p class="gg-hint">{{ t("quickGuide.ready.body") }}</p>
        <AppAlert :variant="readinessType" :title="readinessTitle">
          <AppSpinner v-if="statusPending" size="sm" :label="t('quickGuide.ready.checking')" />
        </AppAlert>

        <dl v-if="isMacOS && platformStatus" class="quick-guide__permissions">
          <div>
            <dt>{{ t("options.general.permissions.accessibility") }}</dt>
            <dd>
              <span class="quick-guide__permission-state" :class="platformStatus.accessibility ? 'is-granted' : 'is-missing'">
                {{ t(platformStatus.accessibility ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </span>
            </dd>
          </div>
          <div>
            <dt>{{ t("options.general.permissions.inputMonitoring") }}</dt>
            <dd>
              <span class="quick-guide__permission-state" :class="platformStatus.inputMonitoring ? 'is-granted' : 'is-missing'">
                {{ t(platformStatus.inputMonitoring ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </span>
            </dd>
          </div>
          <div>
            <dt>{{ t("options.general.permissions.eventPosting") }}</dt>
            <dd>
              <span class="quick-guide__permission-state" :class="platformStatus.eventPosting ? 'is-granted' : 'is-missing'">
                {{ t(platformStatus.eventPosting ? "options.general.permissions.granted" : "options.general.permissions.missing") }}
              </span>
            </dd>
          </div>
        </dl>

        <div v-if="isMacOS && !ready" class="quick-guide__permission-actions">
          <AppButton
            variant="primary"
            :loading="permissionPending"
            :loading-label="t('options.general.permissions.request')"
            :aria-label="t('options.general.permissions.request')"
            @click="requestPermissions"
          >
            {{ t("options.general.permissions.request") }}
          </AppButton>
          <AppButton :disabled="dialogBusy" :aria-label="t('options.general.permissions.openSettings')" @click="openPermissionSettings">
            {{ t("options.general.permissions.openSettings") }}
          </AppButton>
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
        <p v-else class="quick-guide__empty">{{ t("quickGuide.try.empty") }}</p>
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
            <AppButton :aria-label="`${t('quickGuide.personalize.open')} ${t('quickGuide.personalize.gestures')}`" @click="navigate('gestures')">
              <Crosshair aria-hidden="true" />
              {{ t("quickGuide.personalize.open") }}
            </AppButton>
          </div>
          <div class="quick-guide__destination">
            <div>
              <strong>{{ t("quickGuide.personalize.templates") }}</strong>
              <span>{{ t("quickGuide.personalize.templatesDesc") }}</span>
            </div>
            <AppButton :aria-label="`${t('quickGuide.personalize.open')} ${t('quickGuide.personalize.templates')}`" @click="navigate('templates')">
              <LibraryBig aria-hidden="true" />
              {{ t("quickGuide.personalize.open") }}
            </AppButton>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="quick-guide__footer">
        <div>
          <AppButton v-if="activeStep > 0" :disabled="dialogBusy" :aria-label="t('quickGuide.back')" @click="activeStep -= 1">
            <ArrowLeft aria-hidden="true" />
            {{ t("quickGuide.back") }}
          </AppButton>
        </div>
        <div>
          <AppButton
            v-if="activeStep < 2"
            variant="primary"
            :disabled="dialogBusy"
            :aria-label="t('quickGuide.next')"
            @click="activeStep += 1"
          >
            {{ t("quickGuide.next") }}
            <ArrowRight aria-hidden="true" />
          </AppButton>
          <AppButton v-else variant="primary" :disabled="dialogBusy" :aria-label="t('quickGuide.finish')" @click="close">
            {{ t("quickGuide.finish") }}
          </AppButton>
        </div>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.quick-guide__content {
  min-height: 300px;
  padding-top: 24px;
}
:deep(.gg-dialog.quick-guide) { width: min(620px, calc(100vw - 32px)); }
.quick-guide__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.quick-guide__steps li {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--gg-text-muted);
  font-size: 12px;
}
.quick-guide__steps li.is-active,
.quick-guide__steps li.is-complete { color: var(--gg-primary); }
.quick-guide__step-number {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
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
  border-top: 1px solid var(--gg-border);
}
.quick-guide__permissions > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--gg-border);
}
.quick-guide__permissions dt {
  color: var(--gg-text);
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
.quick-guide__permission-state {
  display: inline-flex;
  padding: 2px 7px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 12px;
  line-height: 16px;
}
.quick-guide__permission-state.is-granted {
  border-color: var(--gg-success-border);
  background: var(--gg-success-soft);
  color: var(--gg-success);
}
.quick-guide__permission-state.is-missing {
  border-color: var(--gg-warning-border);
  background: var(--gg-warning-soft);
  color: var(--gg-warning);
}
.quick-guide__examples {
  border-top: 1px solid var(--gg-border);
}
.quick-guide__example {
  min-height: 48px;
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--gg-border);
  color: var(--gg-text);
  font-size: 13px;
}
.quick-guide__destinations {
  border-top: 1px solid var(--gg-border);
}
.quick-guide__destination {
  min-height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid var(--gg-border);
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
  color: var(--gg-text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.quick-guide__destination .gg-button { flex: none; }
.quick-guide__empty {
  margin: 0;
  padding: 18px 12px;
  color: var(--gg-text-muted);
  font-size: 13px;
  text-align: center;
}
.quick-guide__footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
