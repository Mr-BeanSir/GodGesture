<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FileJson } from "lucide-vue-next";
import { AppAlert, AppButton, AppDialog } from "@godgesture/ui";
import { GestureTemplateProtocolError, parseGestureTemplatePackage } from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useTemplatesStore } from "../stores/templates";
import GestureTemplateAdoptionDialog from "./GestureTemplateAdoptionDialog.vue";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();

const { t } = useI18n();
const backend = useBackend();
const templates = useTemplatesStore();

const loading = ref(false);
const importError = ref<string | null>(null);
const fileDialogVisible = ref(false);

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const detailVisible = computed(() => visible.value && templates.selectedEntry !== null);

function errorText(code: string): string {
  const key = "templates.errors." + code;
  const translated = t(key);
  return translated === key ? t("gestures.importDialog.failed") : translated;
}

function closeImport(): void {
  if (loading.value || templates.adopting) return;
  visible.value = false;
  templates.closeDetails();
}

async function chooseFile(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  importError.value = null;
  try {
    const text = await backend.gestureTemplateOpen(t("gestures.importDialog.fileTitle"));
    if (!text) return;
    try {
      const templatePackage = parseGestureTemplatePackage(text);
      templates.openLocalPackage(templatePackage);
      fileDialogVisible.value = false;
    } catch (error) {
      const code = error instanceof GestureTemplateProtocolError ? error.code : "invalid_package";
      importError.value = errorText(code);
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
    importError.value = errorText(code);
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  importError.value = null;
  fileDialogVisible.value = true;
  templates.closeDetails();
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      void chooseFile();
    } else if (!templates.adopting) {
      fileDialogVisible.value = false;
      templates.closeDetails();
    }
  },
  { immediate: true },
);
</script>

<template>
  <AppDialog
    :open="visible && fileDialogVisible && !templates.selectedEntry"
    :title="t('gestures.importDialog.title')"
    :close-label="t('common.cancel')"
    :busy="loading"
    @close="closeImport"
  >
    <div class="gesture-import__pick">
      <FileJson :size="34" aria-hidden="true" />
      <p class="gg-hint">{{ t("gestures.importDialog.description") }}</p>
      <AppButton variant="primary" :loading="loading" @click="chooseFile">
        <FileJson :size="16" aria-hidden="true" />
        {{ t("gestures.importDialog.chooseFile") }}
      </AppButton>
    </div>
    <AppAlert v-if="importError" class="gesture-import__error" variant="error" :title="importError" />
  </AppDialog>

  <GestureTemplateAdoptionDialog
    :open="detailVisible"
    :close-label="t('common.cancel')"
    @close="closeImport"
    @adopted="closeImport"
  />
</template>

<style scoped>
.gesture-import__pick {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 26px 18px;
  border: 1px dashed var(--gg-border);
  border-radius: 8px;
  color: var(--gg-primary);
  text-align: center;
}

.gesture-import__pick p { margin: 0; }
.gesture-import__pick .gg-button { min-width: 150px; }
.gesture-import__error { margin-top: 12px; }
</style>
