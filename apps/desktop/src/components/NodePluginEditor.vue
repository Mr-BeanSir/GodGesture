<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Plus } from "@element-plus/icons-vue";
import type { NodePlugin, NodePluginCommand } from "@godgesture/shared";
import { DEFAULT_NODE_PLUGIN_MANIFEST, DEFAULT_NODE_PLUGIN_SOURCE } from "@godgesture/shared";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import ScriptEditor from "./ScriptEditor.vue";

const props = defineProps<{ modelValue: NodePluginCommand }>();
const emit = defineEmits<{ (event: "update:modelValue", value: NodePluginCommand): void }>();
const { t } = useI18n();
const store = useConfigStore();
const newFilePath = ref("");
const activeFile = ref("index.mjs");

const plugins = computed(() => store.doc?.nodePlugins ?? []);
const plugin = computed<NodePlugin | null>(() =>
  plugins.value.find((candidate) => candidate.id === props.modelValue.pluginId) ?? null,
);
const fileNames = computed(() => (plugin.value ? Object.keys(plugin.value.files).sort() : []));
const activeSource = computed({
  get: () => plugin.value?.files[activeFile.value] ?? "",
  set: (value: string) => {
    if (plugin.value && activeFile.value in plugin.value.files) plugin.value.files[activeFile.value] = value;
  },
});

function createPlugin() {
  if (!store.doc) return;
  const created: NodePlugin = {
    id: newId(),
    name: t("command.nodePlugin.newName"),
    entry: "index.mjs",
    files: { "index.mjs": DEFAULT_NODE_PLUGIN_SOURCE },
    packageJson: DEFAULT_NODE_PLUGIN_MANIFEST,
    lockfile: null,
    allowLifecycleScripts: false,
  };
  store.doc.nodePlugins.push(created);
  emit("update:modelValue", { type: "nodePlugin", pluginId: created.id, exportName: "execute" });
  activeFile.value = created.entry;
}

function selectPlugin(id: string) {
  const selected = plugins.value.find((candidate) => candidate.id === id);
  if (!selected) return;
  emit("update:modelValue", { ...props.modelValue, pluginId: selected.id });
  activeFile.value = selected.entry;
}

function addFile() {
  const path = newFilePath.value.trim();
  if (!plugin.value || !path || path.includes("\\") || path.startsWith("/") || path.includes("..")) return;
  if (path in plugin.value.files) {
    activeFile.value = path;
    newFilePath.value = "";
    return;
  }
  plugin.value.files[path] = "";
  activeFile.value = path;
  newFilePath.value = "";
}

function deleteFile(path: string) {
  if (!plugin.value || path === plugin.value.entry) return;
  delete plugin.value.files[path];
  activeFile.value = plugin.value.entry;
}

function setEntry(path: string) {
  if (plugin.value && path in plugin.value.files) plugin.value.entry = path;
}

watch(
  () => [props.modelValue.pluginId, plugin.value?.entry] as const,
  ([, entry]) => {
    if (entry && !(activeFile.value in (plugin.value?.files ?? {}))) activeFile.value = entry;
  },
  { immediate: true },
);

watch(
  plugins,
  () => {
    if (!plugin.value && plugins.value.length) selectPlugin(plugins.value[0]!.id);
  },
  { immediate: true },
);
</script>

<template>
  <div class="node-plugin-editor">
    <div class="node-plugin-editor__toolbar">
      <el-select
        v-if="plugins.length"
        :model-value="plugin?.id"
        class="node-plugin-editor__plugin-select"
        @update:model-value="selectPlugin"
      >
        <el-option v-for="item in plugins" :key="item.id" :label="item.name" :value="item.id" />
      </el-select>
      <el-button size="small" :icon="Plus" @click="createPlugin">{{ t("command.nodePlugin.newPlugin") }}</el-button>
    </div>

    <template v-if="plugin">
      <div class="node-plugin-editor__meta">
        <div class="gg-field">
          <label class="gg-field-label">{{ t("command.nodePlugin.name") }}</label>
          <el-input v-model="plugin.name" maxlength="64" />
        </div>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("command.nodePlugin.exportName") }}</label>
          <el-input
            :model-value="modelValue.exportName"
            @update:model-value="emit('update:modelValue', { ...modelValue, exportName: $event })"
          />
        </div>
      </div>

      <div class="node-plugin-editor__workspace">
        <aside class="node-plugin-editor__files">
          <div class="node-plugin-editor__files-head">
            <span>{{ t("command.nodePlugin.files") }}</span>
            <el-button link :icon="Plus" :aria-label="t('command.nodePlugin.addFile')" @click="addFile" />
          </div>
          <div class="node-plugin-editor__add-file">
            <el-input
              v-model="newFilePath"
              size="small"
              :placeholder="t('command.nodePlugin.filePlaceholder')"
              @keyup.enter="addFile"
            />
          </div>
          <div
            v-for="file in fileNames"
            :key="file"
            class="node-plugin-editor__file"
            :class="{ 'is-active': file === activeFile }"
          >
            <button type="button" class="node-plugin-editor__file-select" @click="activeFile = file">
              <span>{{ file }}</span>
            </button>
            <el-tooltip v-if="file !== plugin.entry" :content="t('command.nodePlugin.deleteFile')">
              <el-button
                link
                size="small"
                :icon="Delete"
                :aria-label="t('command.nodePlugin.deleteFile')"
                @click.stop="deleteFile(file)"
              />
            </el-tooltip>
          </div>
          <div class="node-plugin-editor__file-actions">
            <el-button size="small" :disabled="activeFile === plugin.entry" @click="setEntry(activeFile)">
              {{ t("command.nodePlugin.setEntry") }}
            </el-button>
          </div>
        </aside>

        <section class="node-plugin-editor__code">
          <div class="node-plugin-editor__code-head">
            <span>{{ activeFile }}</span>
            <span v-if="activeFile === plugin.entry" class="node-plugin-editor__entry">{{ t("command.nodePlugin.entry") }}</span>
          </div>
          <ScriptEditor v-model="activeSource" language="js" :editor-label="activeFile" :height="260" />
        </section>
      </div>

      <div class="node-plugin-editor__package-grid">
        <div class="gg-field">
          <label class="gg-field-label">{{ t("command.nodePlugin.manifest") }}</label>
          <ScriptEditor v-model="plugin.packageJson" language="json" :editor-label="t('command.nodePlugin.manifest')" :height="150" />
        </div>
        <div class="gg-field">
          <label class="gg-field-label">{{ t("command.nodePlugin.lockfile") }}</label>
          <el-input v-model="plugin.lockfile" type="textarea" :rows="7" :placeholder="t('command.nodePlugin.lockfilePlaceholder')" />
        </div>
      </div>
      <el-alert :title="t('command.nodePlugin.syncHint')" type="info" :closable="false" />
      <label class="gg-switch-row">
        <el-switch v-model="plugin.allowLifecycleScripts" />
        <span>{{ t("command.nodePlugin.allowLifecycleScripts") }}</span>
      </label>
    </template>
    <el-empty v-else :description="t('command.nodePlugin.empty')" :image-size="48" />
  </div>
</template>

<style scoped>
.node-plugin-editor { container-type: inline-size; display: grid; min-width: 0; gap: 12px; }
.node-plugin-editor__toolbar, .node-plugin-editor__meta { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
.node-plugin-editor__plugin-select { min-width: 180px; max-width: 280px; }
.node-plugin-editor__meta { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, .6fr); align-items: start; }
.node-plugin-editor__workspace { display: grid; grid-template-columns: minmax(150px, 0.32fr) minmax(0, 1fr); min-height: 300px; border: 1px solid var(--el-border-color); border-radius: 4px; overflow: hidden; }
.node-plugin-editor__files { min-width: 0; max-height: 300px; overflow-x: hidden; overflow-y: auto; border-right: 1px solid var(--el-border-color); background: var(--el-fill-color-light); }
.node-plugin-editor__files-head, .node-plugin-editor__code-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 0 8px; border-bottom: 1px solid var(--el-border-color); font-size: 12px; color: var(--el-text-color-secondary); }
.node-plugin-editor__add-file { padding: 6px; }
.node-plugin-editor__file { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 30px; padding: 0 7px 0 0; color: var(--el-text-color-regular); }
.node-plugin-editor__file:hover, .node-plugin-editor__file.is-active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.node-plugin-editor__file-select { min-width: 0; flex: 1; align-self: stretch; padding: 4px 4px 4px 10px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.node-plugin-editor__file-select:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.node-plugin-editor__file-select span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px/1.4 "Cascadia Code", Consolas, monospace; }
.node-plugin-editor__file-actions { padding: 8px; }
.node-plugin-editor__code { min-width: 0; background: var(--el-fill-color-blank); }
.node-plugin-editor__code-head { color: var(--el-text-color-primary); font-family: "Cascadia Code", Consolas, monospace; }
.node-plugin-editor__entry { color: var(--el-color-success); font-family: inherit; }
.node-plugin-editor__package-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@container (max-width: 520px) {
  .node-plugin-editor__meta,
  .node-plugin-editor__package-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width: 420px) {
  .node-plugin-editor__workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .node-plugin-editor__files {
    max-height: 160px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color);
  }
}
</style>
