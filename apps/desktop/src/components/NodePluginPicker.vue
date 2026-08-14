<script setup lang="ts">
import { computed, onMounted } from "vue";
import { FolderOpen, RefreshCw } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { AppAlert, AppButton } from "@godgesture/ui";
import type { NodePluginCommand } from "@godgesture/shared";
import { usePluginsStore } from "../stores/plugins";

const props = defineProps<{ modelValue: NodePluginCommand }>();
const emit = defineEmits<{ (event: "update:modelValue", value: NodePluginCommand): void }>();
const { t } = useI18n();
const plugins = usePluginsStore();

const selectedPlugin = computed(() =>
  plugins.readyPlugins.find((plugin) => plugin.id === props.modelValue.pluginId) ?? null,
);

function selectPlugin(event: Event) {
  emit("update:modelValue", {
    type: "nodePlugin",
    pluginId: (event.target as HTMLSelectElement).value,
  });
}

onMounted(() => void plugins.initialize());
</script>

<template>
  <div class="node-plugin-picker">
    <div class="gg-field">
      <label class="gg-field-label" for="node-plugin-project">{{ t("command.nodePlugin.plugin") }}</label>
      <div class="node-plugin-picker__row">
        <select
          id="node-plugin-project"
          class="gg-select node-plugin-picker__select"
          :value="selectedPlugin?.id ?? ''"
          @change="selectPlugin"
        >
          <option value="" disabled>{{ t("command.nodePlugin.selectPlugin") }}</option>
          <option v-for="plugin in plugins.readyPlugins" :key="plugin.id" :value="plugin.id">
            {{ plugin.name }}
          </option>
        </select>
        <button
          type="button"
          class="gg-icon-button"
          :aria-label="t('plugins.openFolder')"
          :title="t('plugins.openFolder')"
          @click="plugins.openRoot()"
        >
          <FolderOpen aria-hidden="true" />
        </button>
        <AppButton
          class="node-plugin-picker__refresh"
          variant="quiet"
          :loading="plugins.loading"
          :loading-label="t('plugins.rescan')"
          :aria-label="t('plugins.rescan')"
          :title="t('plugins.rescan')"
          @click="plugins.refresh()"
        >
          <RefreshCw aria-hidden="true" />
        </AppButton>
      </div>
    </div>

    <p v-if="selectedPlugin" class="gg-hint">
      {{ t("command.nodePlugin.lifecycleHint") }}
    </p>

    <AppAlert v-if="plugins.error" variant="error">{{ plugins.error.message }}</AppAlert>
    <AppAlert v-else-if="props.modelValue.pluginId && !selectedPlugin" variant="warning">
      {{ t("command.nodePlugin.missingPlugin", { id: props.modelValue.pluginId }) }}
    </AppAlert>
    <AppAlert v-else-if="plugins.readyPlugins.length === 0" variant="info">
      {{ t("command.nodePlugin.noPlugins") }}
    </AppAlert>
  </div>
</template>

<style scoped>
.node-plugin-picker { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.node-plugin-picker__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.node-plugin-picker__select { flex: 1 1 auto; min-width: 0; }
.node-plugin-picker__refresh { min-width: 44px; padding-inline: 10px; }
.node-plugin-picker__refresh :deep(svg) { width: 18px; height: 18px; }
</style>
