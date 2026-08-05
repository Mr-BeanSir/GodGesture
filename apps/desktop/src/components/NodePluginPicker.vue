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
const referencedAction = computed(() =>
  selectedPlugin.value?.actions.find((action) => action.id === props.modelValue.actionId) ?? null,
);

function selectPlugin(pluginId: string) {
  const plugin = plugins.readyPlugins.find((candidate) => candidate.id === pluginId);
  emit("update:modelValue", {
    type: "nodePlugin",
    pluginId,
    actionId: plugin?.actions[0]?.id ?? "default",
  });
}

function selectAction(actionId: string) {
  emit("update:modelValue", { ...props.modelValue, actionId });
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

    <div class="gg-field">
      <label class="gg-field-label" for="node-plugin-action">{{ t("command.nodePlugin.action") }}</label>
      <el-select
        id="node-plugin-action"
        :model-value="modelValue.actionId"
        :disabled="!selectedPlugin"
        :placeholder="t('command.nodePlugin.selectAction')"
        @update:model-value="selectAction"
      >
        <el-option
          v-for="action in selectedPlugin?.actions ?? []"
          :key="action.id"
          :label="action.name"
          :value="action.id"
        >
          <span>{{ action.name }}</span>
          <code class="node-plugin-picker__export">{{ action.exportName }}</code>
        </el-option>
      </el-select>
    </div>

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
      v-else-if="selectedPlugin && !referencedAction"
      type="warning"
      show-icon
      :closable="false"
      :title="t('command.nodePlugin.missingAction', { id: props.modelValue.actionId })"
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
.node-plugin-picker__export { float: right; margin-left: 18px; color: var(--el-text-color-secondary); font-size: 11px; }
</style>
