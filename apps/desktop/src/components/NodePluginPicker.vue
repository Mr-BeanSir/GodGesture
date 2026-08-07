<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { FolderOpened, Refresh } from "@element-plus/icons-vue";
import type { NodePluginCommand } from "@godgesture/shared";
import { usePluginsStore } from "../stores/plugins";

const props = defineProps<{ modelValue: NodePluginCommand }>();
const emit = defineEmits<{ (event: "update:modelValue", value: NodePluginCommand): void }>();
const { t } = useI18n();
const plugins = usePluginsStore();

const selectedPlugin = computed(() =>
  plugins.readyPlugins.find((plugin) => plugin.id === props.modelValue.pluginId) ?? null,
);
function selectPlugin(pluginId: string) {
  emit("update:modelValue", {
    type: "nodePlugin",
    pluginId,
  });
}

onMounted(() => void plugins.initialize());
</script>

<template>
  <div class="node-plugin-picker">
    <div class="gg-field">
      <label class="gg-field-label" for="node-plugin-project">{{ t("command.nodePlugin.plugin") }}</label>
      <div class="node-plugin-picker__row">
        <el-select
          :model-value="selectedPlugin?.id ?? ''"
          id="node-plugin-project"
          class="node-plugin-picker__select"
          :placeholder="t('command.nodePlugin.selectPlugin')"
          @update:model-value="selectPlugin"
        >
          <el-option
            v-for="plugin in plugins.readyPlugins"
            :key="plugin.id"
            :label="plugin.name"
            :value="plugin.id"
          />
        </el-select>
        <el-tooltip :content="t('plugins.openFolder')">
          <el-button
            :icon="FolderOpened"
            circle
            :aria-label="t('plugins.openFolder')"
            @click="plugins.openRoot()"
          />
        </el-tooltip>
        <el-tooltip :content="t('plugins.rescan')">
          <el-button
            :icon="Refresh"
            circle
            :loading="plugins.loading"
            :aria-label="t('plugins.rescan')"
            @click="plugins.refresh()"
          />
        </el-tooltip>
      </div>
    </div>

    <p v-if="selectedPlugin" class="gg-hint">
      {{ t("command.nodePlugin.lifecycleHint") }}
    </p>

    <el-alert
      v-if="plugins.error"
      type="error"
      show-icon
      :closable="false"
      :title="plugins.error.message"
    />
    <el-alert
      v-else-if="props.modelValue.pluginId && !selectedPlugin"
      type="warning"
      show-icon
      :closable="false"
      :title="t('command.nodePlugin.missingPlugin', { id: props.modelValue.pluginId })"
    />
    <el-alert
      v-else-if="plugins.readyPlugins.length === 0"
      type="info"
      show-icon
      :closable="false"
      :title="t('command.nodePlugin.noPlugins')"
    />
  </div>
</template>

<style scoped>
.node-plugin-picker { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.node-plugin-picker__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.node-plugin-picker__select { flex: 1 1 auto; min-width: 0; }
</style>
