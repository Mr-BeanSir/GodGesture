<script setup lang="ts">
import { computed, ref, toRaw, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Plus, Refresh, Search, VideoPlay } from "@element-plus/icons-vue";
import type { NodePlugin, NodePluginCommand } from "@godgesture/shared";
import { DEFAULT_NODE_PLUGIN_MANIFEST, DEFAULT_NODE_PLUGIN_SOURCE } from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import {
  listPluginDependencies,
  removePluginDependency,
  setPluginDependency,
} from "../utils/nodePluginPackages";
import type { NodePackageSearchResult } from "../api/backend";
import ScriptEditor from "./ScriptEditor.vue";

const props = defineProps<{ modelValue: NodePluginCommand }>();
const emit = defineEmits<{ (event: "update:modelValue", value: NodePluginCommand): void }>();
const { t } = useI18n();
const store = useConfigStore();
const backend = useBackend();
const newFilePath = ref("");
const activeFile = ref("index.mjs");
const dependencyName = ref("");
const dependencySpec = ref("latest");
const packageState = ref<"idle" | "running" | "ready" | "error">("idle");
const packageOutput = ref("");
const packageError = ref("");
const activeBottomTab = ref("problems");
const packageSearchResults = ref<NodePackageSearchResult[]>([]);
const packageSearchState = ref<"idle" | "running" | "error">("idle");
const packageSearchError = ref("");
const testState = ref<"idle" | "running" | "ready" | "error">("idle");
type UpdateInfo = { state: "idle" | "running" | "ready" | "error"; latest?: string; error?: string };
const updateInfo = ref<Record<string, UpdateInfo>>({});

const plugins = computed(() => store.doc?.nodePlugins ?? []);
const plugin = computed<NodePlugin | null>(() =>
  plugins.value.find((candidate) => candidate.id === props.modelValue.pluginId) ?? null,
);
const fileNames = computed(() => (plugin.value ? Object.keys(plugin.value.files).sort() : []));
const manifestError = computed(() => {
  if (!plugin.value) return "";
  try {
    listPluginDependencies(plugin.value.packageJson);
    return "";
  } catch {
    return t("command.nodePlugin.problemManifest");
  }
});
const dependencies = computed(() => {
  if (!plugin.value || manifestError.value) return [];
  return listPluginDependencies(plugin.value.packageJson);
});
const problems = computed(() => {
  const result: string[] = [];
  if (manifestError.value) result.push(manifestError.value);
  if (dependencies.value.length && !plugin.value?.lockfile) {
    result.push(t("command.nodePlugin.problemLockfile"));
  }
  if (packageError.value) result.push(packageError.value);
  if (packageSearchError.value) result.push(packageSearchError.value);
  for (const info of Object.values(updateInfo.value)) {
    if (info.state === "error" && info.error) result.push(info.error);
  }
  return result;
});
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

function addDependency() {
  if (!plugin.value) return;
  try {
    plugin.value.packageJson = setPluginDependency(
      plugin.value.packageJson,
      dependencyName.value,
      dependencySpec.value,
    );
    plugin.value.lockfile = null;
    dependencyName.value = "";
    dependencySpec.value = "latest";
    packageState.value = "idle";
    packageError.value = "";
  } catch (error) {
    packageError.value = t(`command.nodePlugin.${error instanceof Error ? error.message : "packageSpecInvalid"}`);
    activeBottomTab.value = "problems";
  }
}

function removeDependency(name: string) {
  if (!plugin.value) return;
  plugin.value.packageJson = removePluginDependency(plugin.value.packageJson, name);
  plugin.value.lockfile = null;
  packageState.value = "idle";
  packageError.value = "";
  delete updateInfo.value[name];
}

async function searchPackages() {
  const query = dependencyName.value.trim();
  if (query.length < 2) return;
  packageSearchState.value = "running";
  packageSearchError.value = "";
  try {
    packageSearchResults.value = await backend.nodePluginPackageSearch(query);
    packageSearchState.value = "idle";
  } catch (error) {
    packageSearchState.value = "error";
    packageSearchResults.value = [];
    packageSearchError.value = error instanceof Error ? error.message : String(error);
    activeBottomTab.value = "problems";
  }
}

function useSearchResult(result: NodePackageSearchResult) {
  dependencyName.value = result.name;
  dependencySpec.value = result.version;
  packageSearchResults.value = [];
  packageSearchError.value = "";
}

async function checkUpdates() {
  if (!dependencies.value.length) return;
  const names = dependencies.value.map((dependency) => dependency.name);
  for (const name of names) updateInfo.value[name] = { state: "running" };
  let cursor = 0;
  const worker = async () => {
    while (cursor < names.length) {
      const name = names[cursor++];
      try {
        const latest = await backend.nodePluginPackageLatest(name);
        const current = dependencies.value.find((dependency) => dependency.name === name)?.spec;
        updateInfo.value[name] = { state: "ready", latest: latest === current ? undefined : latest };
      } catch (error) {
        updateInfo.value[name] = {
          state: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, worker));
}

function applyUpdate(name: string) {
  const latest = updateInfo.value[name]?.latest;
  if (!latest || !plugin.value) return;
  try {
    plugin.value.packageJson = setPluginDependency(plugin.value.packageJson, name, latest);
    plugin.value.lockfile = null;
    updateInfo.value[name] = { state: "idle" };
    packageState.value = "idle";
    packageError.value = "";
  } catch (error) {
    packageError.value = error instanceof Error ? error.message : String(error);
    activeBottomTab.value = "problems";
  }
}

async function prepareDependencies() {
  if (!plugin.value || manifestError.value) return;
  packageState.value = "running";
  packageError.value = "";
  packageOutput.value = "";
  activeBottomTab.value = "output";
  try {
    const snapshot = JSON.parse(JSON.stringify(toRaw(plugin.value))) as NodePlugin;
    const result = await backend.nodePluginInstall(snapshot);
    plugin.value.lockfile = result.lockfile;
    packageOutput.value = result.output || t("command.nodePlugin.prepareComplete");
    packageState.value = result.ready ? "ready" : "error";
  } catch (error) {
    packageState.value = "error";
    packageError.value = error instanceof Error ? error.message : String(error);
    packageOutput.value = packageError.value;
    activeBottomTab.value = "problems";
  }
}

async function testPlugin() {
  if (!plugin.value || manifestError.value) return;
  testState.value = "running";
  packageError.value = "";
  packageOutput.value = "";
  activeBottomTab.value = "output";
  try {
    const snapshot = JSON.parse(JSON.stringify(toRaw(plugin.value))) as NodePlugin;
    const result = await backend.nodePluginTest(snapshot, props.modelValue.exportName);
    packageOutput.value = result.output || t("command.nodePlugin.testComplete");
    testState.value = result.ready ? "ready" : "error";
  } catch (error) {
    testState.value = "error";
    packageError.value = error instanceof Error ? error.message : String(error);
    packageOutput.value = packageError.value;
    activeBottomTab.value = "problems";
  }
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

watch(
  () => [plugin.value?.id, plugin.value?.packageJson] as const,
  ([id, manifest], [previousId, previousManifest]) => {
    if (plugin.value && id === previousId && manifest !== previousManifest) {
      plugin.value.lockfile = null;
      packageState.value = "idle";
    }
  },
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

      <section class="node-plugin-editor__dependencies">
        <div class="node-plugin-editor__section-head">
          <div class="node-plugin-editor__section-copy">
            <strong>{{ t("command.nodePlugin.dependencies") }}</strong>
            <span class="gg-hint">{{ t("command.nodePlugin.dependenciesHint") }}</span>
          </div>
          <div class="node-plugin-editor__section-actions">
            <el-button size="small" :icon="Refresh" :loading="packageState === 'running'" :disabled="Boolean(manifestError)" @click="prepareDependencies">
              {{ t("command.nodePlugin.prepare") }}
            </el-button>
            <el-button v-if="dependencies.length" size="small" :icon="Search" :loading="Object.values(updateInfo).some((item) => item.state === 'running')" @click="checkUpdates">
              {{ t("command.nodePlugin.checkUpdates") }}
            </el-button>
            <el-button size="small" :icon="VideoPlay" :loading="testState === 'running'" :disabled="Boolean(manifestError)" @click="testPlugin">
              {{ t("command.nodePlugin.testHandler") }}
            </el-button>
          </div>
        </div>
        <div class="node-plugin-editor__dependency-add">
          <div class="node-plugin-editor__package-search">
            <el-input
              v-model="dependencyName"
              size="small"
              :placeholder="t('command.nodePlugin.packageName')"
              @keyup.enter="searchPackages"
            />
            <el-button
              size="small"
              :icon="Search"
              :loading="packageSearchState === 'running'"
              :aria-label="t('command.nodePlugin.searchPackages')"
              @click="searchPackages"
            />
          </div>
          <el-input
            v-model="dependencySpec"
            size="small"
            :placeholder="t('command.nodePlugin.packageSpec')"
            @keyup.enter="addDependency"
          />
          <el-button size="small" :icon="Plus" @click="addDependency">
            {{ t("command.nodePlugin.addDependency") }}
          </el-button>
        </div>
        <div v-if="packageSearchResults.length" class="node-plugin-editor__search-results">
          <button
            v-for="result in packageSearchResults"
            :key="`${result.name}@${result.version}`"
            type="button"
            class="node-plugin-editor__search-result"
            @click="useSearchResult(result)"
          >
            <strong>{{ result.name }}</strong>
            <span>{{ result.version }}</span>
            <small>{{ result.description || t("command.nodePlugin.noDescription") }}</small>
          </button>
        </div>
        <div v-if="dependencies.length" class="node-plugin-editor__dependency-list">
          <div v-for="dependency in dependencies" :key="dependency.name" class="node-plugin-editor__dependency">
            <code>{{ dependency.name }}</code>
            <span>{{ dependency.spec }}</span>
            <el-tag v-if="dependency.optional" size="small" type="info">
              {{ t("command.nodePlugin.optional") }}
            </el-tag>
            <el-button
              v-if="updateInfo[dependency.name]?.latest"
              link
              size="small"
              type="primary"
              @click="applyUpdate(dependency.name)"
            >
              {{ t("command.nodePlugin.updateTo", { version: updateInfo[dependency.name]?.latest }) }}
            </el-button>
            <el-tooltip :content="t('command.nodePlugin.removeDependency')">
              <el-button
                link
                size="small"
                :icon="Delete"
                :aria-label="t('command.nodePlugin.removeDependency')"
                @click="removeDependency(dependency.name)"
              />
            </el-tooltip>
          </div>
        </div>
        <div v-else class="gg-hint">{{ t("command.nodePlugin.noDependencies") }}</div>
      </section>

      <label class="gg-switch-row">
        <el-switch v-model="plugin.allowLifecycleScripts" />
        <span>{{ t("command.nodePlugin.allowLifecycleScripts") }}</span>
      </label>
      <el-alert :title="t('command.nodePlugin.syncHint')" type="info" :closable="false" />

      <el-tabs v-model="activeBottomTab" class="node-plugin-editor__bottom-tabs">
        <el-tab-pane :label="`${t('command.nodePlugin.problems')} (${problems.length})`" name="problems">
          <ul v-if="problems.length" class="node-plugin-editor__problems">
            <li v-for="problem in problems" :key="problem">{{ problem }}</li>
          </ul>
          <el-empty v-else :description="t('command.nodePlugin.noProblems')" :image-size="36" />
        </el-tab-pane>
        <el-tab-pane :label="t('command.nodePlugin.output')" name="output">
          <pre class="node-plugin-editor__output">{{ packageOutput || t("command.nodePlugin.noOutput") }}</pre>
        </el-tab-pane>
      </el-tabs>
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
.node-plugin-editor__dependencies { display: grid; min-width: 0; gap: 8px; padding-top: 10px; border-top: 1px solid var(--el-border-color-lighter); }
.node-plugin-editor__section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.node-plugin-editor__section-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.node-plugin-editor__section-head strong { font-size: 13px; font-weight: 600; }
.node-plugin-editor__section-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.node-plugin-editor__dependency-add { display: grid; grid-template-columns: minmax(140px, 1fr) minmax(100px, .5fr) auto; gap: 6px; }
.node-plugin-editor__package-search { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 4px; min-width: 0; }
.node-plugin-editor__search-results { display: grid; max-height: 180px; overflow: auto; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; }
.node-plugin-editor__search-result { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; padding: 7px 9px; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-blank); color: var(--el-text-color-primary); text-align: left; cursor: pointer; }
.node-plugin-editor__search-result:last-child { border-bottom: 0; }
.node-plugin-editor__search-result:hover, .node-plugin-editor__search-result:focus-visible { background: var(--el-color-primary-light-9); outline: none; }
.node-plugin-editor__search-result span { color: var(--el-color-success); font: 12px "Cascadia Code", Consolas, monospace; }
.node-plugin-editor__search-result small { grid-column: 1 / -1; overflow: hidden; color: var(--el-text-color-secondary); text-overflow: ellipsis; white-space: nowrap; }
.node-plugin-editor__dependency-list { display: grid; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; }
.node-plugin-editor__dependency { display: grid; grid-template-columns: minmax(0, 1fr) minmax(80px, .45fr) auto 28px; align-items: center; gap: 8px; min-height: 32px; padding: 0 6px 0 9px; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 12px; }
.node-plugin-editor__dependency:last-child { border-bottom: 0; }
.node-plugin-editor__dependency code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-plugin-editor__dependency > span { color: var(--el-text-color-secondary); }
.node-plugin-editor__bottom-tabs { min-width: 0; }
.node-plugin-editor__problems { display: grid; gap: 5px; margin: 0; padding: 8px 8px 8px 26px; color: var(--el-color-danger); font-size: 12px; }
.node-plugin-editor__output { box-sizing: border-box; max-height: 180px; margin: 0; padding: 10px; overflow: auto; border-radius: 4px; background: var(--el-fill-color-darker); color: var(--el-text-color-primary); font: 12px/1.5 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
@container (max-width: 520px) {
  .node-plugin-editor__meta,
  .node-plugin-editor__package-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .node-plugin-editor__dependency-add {
    grid-template-columns: minmax(0, 1fr) minmax(100px, .55fr);
  }
  .node-plugin-editor__package-search { grid-column: 1 / -1; }
  .node-plugin-editor__dependency-add .el-button {
    grid-column: 1 / -1;
    justify-self: start;
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
