<script setup lang="ts">
/**
 * 命令编辑器:编辑一条 Command(12 类判别联合)。
 * 对外 v-model 为 Command;切换类型时用 createDefaultCommand 生成默认值。
 * 被「手势」区(手势意图)与「触发角 & 摩擦边」区共用。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Command } from "@godgesture/shared";
import {
  COMMAND_TYPES,
  WINDOW_OPERATIONS,
  createDefaultCommand,
  type CommandType,
  type CommandOfType,
} from "../utils/commands";
import HotkeyInput from "./HotkeyInput.vue";
import ScriptEditor from "./ScriptEditor.vue";
import NodePluginEditor from "./NodePluginEditor.vue";
import { useConfigStore } from "../stores/config";
import { newId } from "../utils/id";
import { DEFAULT_NODE_PLUGIN_MANIFEST, DEFAULT_NODE_PLUGIN_SOURCE } from "@godgesture/shared";
import { convertScriptCommandToNodePlugin } from "../utils/nodePluginMigration";

const props = defineProps<{ modelValue: Command }>();
const emit = defineEmits<{ (e: "update:modelValue", value: Command): void }>();

const { t } = useI18n();
const configStore = useConfigStore();

/** 局部字段写入:合并补丁后整体 emit(判别联合下用 Record 逃逸类型约束) */
function patch(partial: Record<string, unknown>) {
  emit("update:modelValue", { ...props.modelValue, ...partial } as Command);
}

const asNodePlugin = computed(() => props.modelValue as CommandOfType<"nodePlugin">);

function ensureNodePlugin() {
  const existing = configStore.doc?.nodePlugins[0];
  if (existing) return existing;
  if (!configStore.doc) return null;
  const created = {
    id: newId(),
    name: t("command.nodePlugin.newName"),
    entry: "index.mjs",
    files: { "index.mjs": DEFAULT_NODE_PLUGIN_SOURCE },
    packageJson: DEFAULT_NODE_PLUGIN_MANIFEST,
    lockfile: null,
    allowLifecycleScripts: false,
  };
  configStore.doc.nodePlugins.push(created);
  return created;
}

function convertScriptToNodePlugin() {
  if (asScript.value.language !== "js" || !configStore.doc) return;
  const migration = convertScriptCommandToNodePlugin(
    asScript.value,
    t("command.nodePlugin.convertedName"),
  );
  configStore.doc.nodePlugins.push(migration.plugin);
  emit("update:modelValue", migration.command);
}

const type = computed<CommandType>({
  get: () => props.modelValue.type,
  set: (next) => {
    if (next === "nodePlugin") {
      const plugin = ensureNodePlugin();
      if (plugin) {
        emit("update:modelValue", { type: "nodePlugin", pluginId: plugin.id, exportName: "execute" });
      }
      return;
    }
    emit("update:modelValue", createDefaultCommand(next));
  },
});

// 各具体类型的只读视图(仅在对应分支内渲染,断言安全)
const asHotKey = computed(() => props.modelValue as CommandOfType<"hotKey">);
const asWebSearch = computed(() => props.modelValue as CommandOfType<"webSearch">);
const asWindow = computed(() => props.modelValue as CommandOfType<"windowControl">);
const asOpenFile = computed(() => props.modelValue as CommandOfType<"openFile">);
const asSendText = computed(() => props.modelValue as CommandOfType<"sendText">);
const asGotoUrl = computed(() => props.modelValue as CommandOfType<"gotoUrl">);
const asCmd = computed(() => props.modelValue as CommandOfType<"cmd">);
const asScript = computed(() => props.modelValue as CommandOfType<"script">);
const asVolume = computed(() => props.modelValue as CommandOfType<"audioVolume">);

const useDefaultBrowser = computed<boolean>({
  get: () => asWebSearch.value.browser === null,
  set: (v) => patch({ browser: v ? null : "" }),
});

interface SearchPreset {
  name: string;
  url: string;
}
const SEARCH_PRESETS: SearchPreset[] = [
  { name: "Google", url: "https://www.google.com/search?q={0}" },
  { name: "Bing", url: "https://www.bing.com/search?q={0}" },
  { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={0}" },
  { name: "Baidu", url: "https://www.baidu.com/s?wd={0}" },
];
function applyPreset(p: SearchPreset) {
  patch({ engineName: p.name, engineUrl: p.url });
}

function updateVolumeDelta(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  patch({ delta: Math.min(20, Math.max(-20, Math.round(value))) });
}
</script>

<template>
  <div class="cmd-editor">
    <div class="gg-field">
      <label class="gg-field-label">{{ t("command.typeLabel") }}</label>
      <el-select v-model="type" class="cmd-editor__type">
        <el-option
          v-for="ct in COMMAND_TYPES"
          :key="ct"
          :label="t(`command.types.${ct}`)"
          :value="ct"
        />
      </el-select>
    </div>

    <!-- 什么也不做 -->
    <p v-if="type === 'doNothing'" class="gg-hint">{{ t("command.doNothing.desc") }}</p>

    <!-- 执行快捷键 -->
    <template v-else-if="type === 'hotKey'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.hotKey.keys") }}</label>
        <HotkeyInput
          multi-keys
          :modifiers="asHotKey.modifiers"
          :keys="asHotKey.keys"
          @update:modifiers="patch({ modifiers: $event })"
          @update:keys="patch({ keys: $event })"
        />
        <p class="gg-hint">{{ t("command.hotKey.hint") }}</p>
      </div>
    </template>

    <!-- Web 搜索 -->
    <template v-else-if="type === 'webSearch'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.webSearch.engineName") }}</label>
        <el-input
          :model-value="asWebSearch.engineName"
          @update:model-value="patch({ engineName: $event })"
        />
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.webSearch.engineUrl") }}</label>
        <el-input
          :model-value="asWebSearch.engineUrl"
          @update:model-value="patch({ engineUrl: $event })"
        />
        <p class="gg-hint">{{ t("command.webSearch.engineUrlHint") }}</p>
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.webSearch.presets") }}</label>
        <div class="cmd-editor__presets">
          <el-button
            v-for="p in SEARCH_PRESETS"
            :key="p.name"
            size="small"
            @click="applyPreset(p)"
          >
            {{ p.name }}
          </el-button>
        </div>
      </div>
      <div class="gg-switch-row">
        <el-switch v-model="useDefaultBrowser" />
        <span>{{ t("command.webSearch.useDefaultBrowser") }}</span>
      </div>
      <div v-if="!useDefaultBrowser" class="gg-field">
        <label class="gg-field-label">{{ t("command.webSearch.browser") }}</label>
        <el-input
          :model-value="asWebSearch.browser ?? ''"
          :placeholder="t('command.webSearch.browserPlaceholder')"
          @update:model-value="patch({ browser: $event })"
        />
      </div>
    </template>

    <!-- 窗口控制 -->
    <template v-else-if="type === 'windowControl'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.windowControl.operation") }}</label>
        <el-select
          :model-value="asWindow.operation"
          @update:model-value="patch({ operation: $event })"
        >
          <el-option
            v-for="op in WINDOW_OPERATIONS"
            :key="op"
            :label="t(`command.windowControl.operations.${op}`)"
            :value="op"
          />
        </el-select>
      </div>
    </template>

    <!-- 任务切换 -->
    <p v-else-if="type === 'taskSwitcher'" class="gg-hint">{{ t("command.taskSwitcher.desc") }}</p>

    <!-- 打开文件 -->
    <template v-else-if="type === 'openFile'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.openFile.path") }}</label>
        <el-input
          :model-value="asOpenFile.path"
          :placeholder="t('command.openFile.pathPlaceholder')"
          @update:model-value="patch({ path: $event })"
        />
      </div>
    </template>

    <!-- 按键序列 -->
    <template v-else-if="type === 'sendText'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.sendText.text") }}</label>
        <el-input
          type="textarea"
          :autosize="{ minRows: 3 }"
          :model-value="asSendText.text"
          @update:model-value="patch({ text: $event })"
        />
        <p class="gg-hint">{{ t("command.sendText.hint") }}</p>
      </div>
    </template>

    <!-- 打开网址 -->
    <template v-else-if="type === 'gotoUrl'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.gotoUrl.url") }}</label>
        <el-input
          :model-value="asGotoUrl.url"
          :placeholder="t('command.gotoUrl.urlPlaceholder')"
          @update:model-value="patch({ url: $event })"
        />
      </div>
    </template>

    <!-- 命令行 -->
    <template v-else-if="type === 'cmd'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.cmd.code") }}</label>
        <el-input
          type="textarea"
          :autosize="{ minRows: 3 }"
          :model-value="asCmd.code"
          @update:model-value="patch({ code: $event })"
        />
      </div>
      <div class="gg-switch-row">
        <el-switch
          :model-value="asCmd.showWindow"
          @update:model-value="patch({ showWindow: $event })"
        />
        <span>{{ t("command.cmd.showWindow") }}</span>
      </div>
      <div class="gg-switch-row">
        <el-switch
          :model-value="asCmd.autoSetWorkingDir"
          @update:model-value="patch({ autoSetWorkingDir: $event })"
        />
        <span>{{ t("command.cmd.autoSetWorkingDir") }}</span>
      </div>
    </template>

    <!-- 脚本 -->
    <template v-else-if="type === 'script'">
      <el-alert
        v-if="asScript.language === 'lua'"
        type="warning"
        :closable="false"
        show-icon
        :title="t('command.script.luaWarning')"
      />
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.script.language") }}</label>
        <el-select
          :model-value="asScript.language"
          class="cmd-editor__lang"
          @update:model-value="patch({ language: $event })"
        >
          <el-option label="JavaScript" value="js" />
          <el-option label="Lua" value="lua" />
        </el-select>
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.script.main") }}</label>
        <ScriptEditor
          :model-value="asScript.script"
          :language="asScript.language"
          :editor-label="t('command.script.main')"
          :height="220"
          @update:model-value="patch({ script: $event })"
        />
      </div>
      <div v-if="asScript.language === 'js'" class="cmd-editor__migration">
        <el-button size="small" @click="convertScriptToNodePlugin">
          {{ t("command.script.convertToNodePlugin") }}
        </el-button>
        <span class="gg-hint">{{ t("command.script.convertHint") }}</span>
      </div>
      <el-collapse class="cmd-editor__advanced">
        <el-collapse-item :title="t('command.script.advanced')" name="advanced">
          <div class="gg-switch-row">
            <el-switch
              :model-value="asScript.handleModifiers"
              @update:model-value="patch({ handleModifiers: $event })"
            />
            <span>{{ t("command.script.handleModifiers") }}</span>
          </div>
          <div class="gg-field">
            <label class="gg-field-label">{{ t("command.script.initScript") }}</label>
            <ScriptEditor
              :model-value="asScript.initScript"
              :language="asScript.language"
              :editor-label="t('command.script.initScript')"
              @update:model-value="patch({ initScript: $event })"
            />
          </div>
          <div class="gg-field">
            <label class="gg-field-label">{{ t("command.script.gestureRecognizedScript") }}</label>
            <ScriptEditor
              :model-value="asScript.gestureRecognizedScript"
              :language="asScript.language"
              :editor-label="t('command.script.gestureRecognizedScript')"
              @update:model-value="patch({ gestureRecognizedScript: $event })"
            />
          </div>
          <div class="gg-field">
            <label class="gg-field-label">{{ t("command.script.modifierTriggeredScript") }}</label>
            <ScriptEditor
              :model-value="asScript.modifierTriggeredScript"
              :language="asScript.language"
              :editor-label="t('command.script.modifierTriggeredScript')"
              @update:model-value="patch({ modifierTriggeredScript: $event })"
            />
          </div>
          <div class="gg-field">
            <label class="gg-field-label">{{ t("command.script.gestureEndedScript") }}</label>
            <ScriptEditor
              :model-value="asScript.gestureEndedScript"
              :language="asScript.language"
              :editor-label="t('command.script.gestureEndedScript')"
              @update:model-value="patch({ gestureEndedScript: $event })"
            />
          </div>
        </el-collapse-item>
      </el-collapse>
    </template>

    <!-- Node 插件 -->
    <NodePluginEditor
      v-else-if="type === 'nodePlugin'"
      :model-value="asNodePlugin"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <!-- 暂停 -->
    <p v-else-if="type === 'pause'" class="gg-hint">{{ t("command.pause.desc") }}</p>

    <!-- 音量控制 -->
    <template v-else-if="type === 'audioVolume'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.audioVolume.delta") }}</label>
        <el-input-number
          :min="-20"
          :max="20"
          :model-value="asVolume.delta"
          @update:model-value="updateVolumeDelta"
        />
        <p class="gg-hint">{{ t("command.audioVolume.hint") }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cmd-editor {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}
.cmd-editor > .gg-field {
  min-width: 0;
}
.cmd-editor__type,
.cmd-editor__lang {
  max-width: 260px;
}
.cmd-editor__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cmd-editor__migration {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.cmd-editor__advanced {
  border-top: none;
}
</style>
