<script setup lang="ts">
/**
 * 命令编辑器:编辑一条 Command 判别联合。
 * 对外 v-model 为 Command;切换类型时用 createDefaultCommand 生成默认值。
 * 被「手势」区(手势意图)与「触发角 & 摩擦边」区共用。
 */
import { computed, ref } from "vue";
import { CircleHelp } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { AppAlert, AppButton, AppDialog } from "@godgesture/ui";
import { parseSendTextDsl, type Command } from "@godgesture/shared";
import {
  COMMAND_TYPES,
  WINDOW_OPERATIONS,
  createDefaultCommand,
  type CommandType,
  type CommandOfType,
} from "../utils/commands";
import HotkeyInput from "./HotkeyInput.vue";
import NodePluginPicker from "./NodePluginPicker.vue";
import { usePluginsStore } from "../stores/plugins";
import { newId } from "../utils/id";

const props = defineProps<{ modelValue: Command }>();
const emit = defineEmits<{ (e: "update:modelValue", value: Command): void }>();

const { t } = useI18n();
const plugins = usePluginsStore();

/** 局部字段写入:合并补丁后整体 emit(判别联合下用 Record 逃逸类型约束) */
function patch(partial: Record<string, unknown>) {
  emit("update:modelValue", { ...props.modelValue, ...partial } as Command);
}

const asNodePlugin = computed(() => props.modelValue as CommandOfType<"nodePlugin">);

const type = computed<CommandType>({
  get: () => props.modelValue.type,
  set: (next) => {
    if (next === "nodePlugin") {
      const plugin = plugins.readyPlugins[0];
      emit("update:modelValue", {
        type: "nodePlugin",
        pluginId: plugin?.id ?? newId(),
      });
      return;
    }
    emit("update:modelValue", createDefaultCommand(next));
  },
});

const asHotKey = computed(() => props.modelValue as CommandOfType<"hotKey">);
const asWebSearch = computed(() => props.modelValue as CommandOfType<"webSearch">);
const asWindow = computed(() => props.modelValue as CommandOfType<"windowControl">);
const asOpenFile = computed(() => props.modelValue as CommandOfType<"openFile">);
const asSendText = computed(() => props.modelValue as CommandOfType<"sendText">);
const asGotoUrl = computed(() => props.modelValue as CommandOfType<"gotoUrl">);
const asCmd = computed(() => props.modelValue as CommandOfType<"cmd">);
const asPowerShell = computed(() => props.modelValue as CommandOfType<"powershell">);
const asVolume = computed(() => props.modelValue as CommandOfType<"audioVolume">);

const sendTextHelpVisible = ref(false);
const sendTextError = computed(() => {
  try {
    parseSendTextDsl(asSendText.value.text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});

const useDefaultBrowser = computed<boolean>({
  get: () => asWebSearch.value.browser === null,
  set: (value) => patch({ browser: value ? null : "" }),
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

function applyPreset(preset: SearchPreset) {
  patch({ engineName: preset.name, engineUrl: preset.url });
}

function updateVolumeDelta(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  patch({ delta: Math.min(20, Math.max(-20, Math.round(value))) });
}
</script>

<template>
  <div class="cmd-editor">
    <div class="gg-field">
      <label class="gg-field-label" for="command-type">{{ t("command.typeLabel") }}</label>
      <select id="command-type" v-model="type" class="gg-select cmd-editor__type">
        <option v-for="commandType in COMMAND_TYPES" :key="commandType" :value="commandType">
          {{ t(`command.types.${commandType}`) }}
        </option>
      </select>
    </div>

    <p v-if="type === 'doNothing'" class="gg-hint">{{ t("command.doNothing.desc") }}</p>

    <template v-else-if="type === 'hotKey'">
      <div class="gg-field">
        <span class="gg-field-label">{{ t("command.hotKey.keys") }}</span>
        <HotkeyInput
          multi-keys
          :modifiers="asHotKey.modifiers"
          :keys="asHotKey.keys"
          @complete="patch({ modifiers: $event.modifiers, keys: $event.keys })"
        />
        <p class="gg-hint">{{ t("command.hotKey.hint") }}</p>
      </div>
    </template>

    <template v-else-if="type === 'webSearch'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-web-search-engine-name">{{ t("command.webSearch.engineName") }}</label>
        <input
          id="command-web-search-engine-name"
          class="gg-input"
          :value="asWebSearch.engineName"
          @input="patch({ engineName: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="gg-field">
        <label class="gg-field-label" for="command-web-search-engine-url">{{ t("command.webSearch.engineUrl") }}</label>
        <input
          id="command-web-search-engine-url"
          class="gg-input"
          :value="asWebSearch.engineUrl"
          @input="patch({ engineUrl: ($event.target as HTMLInputElement).value })"
        />
        <p class="gg-hint">{{ t("command.webSearch.engineUrlHint") }}</p>
      </div>
      <div class="gg-field">
        <span class="gg-field-label">{{ t("command.webSearch.presets") }}</span>
        <div class="cmd-editor__presets">
          <AppButton v-for="preset in SEARCH_PRESETS" :key="preset.name" size="sm" @click="applyPreset(preset)">
            {{ preset.name }}
          </AppButton>
        </div>
      </div>
      <div class="gg-check-row">
        <input id="command-web-search-default-browser" v-model="useDefaultBrowser" class="gg-checkbox" type="checkbox" />
        <label for="command-web-search-default-browser">{{ t("command.webSearch.useDefaultBrowser") }}</label>
      </div>
      <div v-if="!useDefaultBrowser" class="gg-field">
        <label class="gg-field-label" for="command-web-search-browser">{{ t("command.webSearch.browser") }}</label>
        <input
          id="command-web-search-browser"
          class="gg-input"
          :value="asWebSearch.browser ?? ''"
          :placeholder="t('command.webSearch.browserPlaceholder')"
          @input="patch({ browser: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </template>

    <template v-else-if="type === 'windowControl'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-window-operation">{{ t("command.windowControl.operation") }}</label>
        <select
          id="command-window-operation"
          class="gg-select"
          :value="asWindow.operation"
          @change="patch({ operation: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="operation in WINDOW_OPERATIONS" :key="operation" :value="operation">
            {{ t(`command.windowControl.operations.${operation}`) }}
          </option>
        </select>
      </div>
    </template>

    <p v-else-if="type === 'taskSwitcher'" class="gg-hint">{{ t("command.taskSwitcher.desc") }}</p>

    <template v-else-if="type === 'openFile'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-open-file-path">{{ t("command.openFile.path") }}</label>
        <input
          id="command-open-file-path"
          class="gg-input"
          :value="asOpenFile.path"
          :placeholder="t('command.openFile.pathPlaceholder')"
          @input="patch({ path: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </template>

    <template v-else-if="type === 'sendText'">
      <div class="gg-field">
        <div class="cmd-editor__field-head">
          <label class="gg-field-label" for="command-send-text">{{ t("command.sendText.sequence") }}</label>
          <AppButton
            class="cmd-editor__help-button"
            variant="quiet"
            :aria-label="t('command.sendText.syntaxHelp')"
            :title="t('command.sendText.syntaxHelp')"
            @click="sendTextHelpVisible = true"
          >
            <CircleHelp aria-hidden="true" />
          </AppButton>
        </div>
        <textarea
          id="command-send-text"
          class="gg-textarea cmd-editor__textarea"
          rows="8"
          :value="asSendText.text"
          :placeholder="t('command.sendText.dslPlaceholder')"
          @input="patch({ text: ($event.target as HTMLTextAreaElement).value })"
        />
        <AppAlert v-if="sendTextError" variant="error" class="cmd-editor__syntax-error">
          {{ sendTextError }}
        </AppAlert>
        <p class="gg-hint">{{ t("command.sendText.hint") }}</p>
      </div>
      <AppDialog
        :open="sendTextHelpVisible"
        :title="t('command.sendText.syntaxTitle')"
        :close-label="t('common.close')"
        class="cmd-editor__syntax-dialog"
        @close="sendTextHelpVisible = false"
      >
        <div class="cmd-editor__syntax-guide">
          <p>{{ t("command.sendText.syntaxIntro") }}</p>
          <pre>{{ t("command.sendText.syntaxExample") }}</pre>
          <ul>
            <li>{{ t("command.sendText.syntaxText") }}</li>
            <li>{{ t("command.sendText.syntaxKey") }}</li>
            <li>{{ t("command.sendText.syntaxHotkey") }}</li>
            <li>{{ t("command.sendText.syntaxSleep") }}</li>
          </ul>
        </div>
      </AppDialog>
    </template>

    <template v-else-if="type === 'gotoUrl'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-goto-url">{{ t("command.gotoUrl.url") }}</label>
        <input
          id="command-goto-url"
          class="gg-input"
          :value="asGotoUrl.url"
          :placeholder="t('command.gotoUrl.urlPlaceholder')"
          @input="patch({ url: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </template>

    <template v-else-if="type === 'cmd'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-cmd-code">{{ t("command.cmd.code") }}</label>
        <textarea
          id="command-cmd-code"
          class="gg-textarea cmd-editor__code"
          rows="3"
          :value="asCmd.code"
          @input="patch({ code: ($event.target as HTMLTextAreaElement).value })"
        />
      </div>
      <div class="gg-check-row">
        <input
          id="command-cmd-show-window"
          class="gg-checkbox"
          type="checkbox"
          :checked="asCmd.showWindow"
          @change="patch({ showWindow: ($event.target as HTMLInputElement).checked })"
        />
        <label for="command-cmd-show-window">{{ t("command.cmd.showWindow") }}</label>
      </div>
      <div class="gg-check-row">
        <input
          id="command-cmd-auto-working-dir"
          class="gg-checkbox"
          type="checkbox"
          :checked="asCmd.autoSetWorkingDir"
          @change="patch({ autoSetWorkingDir: ($event.target as HTMLInputElement).checked })"
        />
        <label for="command-cmd-auto-working-dir">{{ t("command.cmd.autoSetWorkingDir") }}</label>
      </div>
    </template>

    <template v-else-if="type === 'powershell'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-powershell-code">{{ t("command.powershell.code") }}</label>
        <textarea
          id="command-powershell-code"
          class="gg-textarea cmd-editor__code"
          rows="3"
          :value="asPowerShell.code"
          @input="patch({ code: ($event.target as HTMLTextAreaElement).value })"
        />
      </div>
      <div class="gg-check-row">
        <input
          id="command-powershell-show-window"
          class="gg-checkbox"
          type="checkbox"
          :checked="asPowerShell.showWindow"
          @change="patch({ showWindow: ($event.target as HTMLInputElement).checked })"
        />
        <label for="command-powershell-show-window">{{ t("command.powershell.showWindow") }}</label>
      </div>
      <div class="gg-check-row">
        <input
          id="command-powershell-auto-working-dir"
          class="gg-checkbox"
          type="checkbox"
          :checked="asPowerShell.autoSetWorkingDir"
          @change="patch({ autoSetWorkingDir: ($event.target as HTMLInputElement).checked })"
        />
        <label for="command-powershell-auto-working-dir">{{ t("command.powershell.autoSetWorkingDir") }}</label>
      </div>
    </template>

    <NodePluginPicker
      v-else-if="type === 'nodePlugin'"
      :model-value="asNodePlugin"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <template v-else-if="type === 'audioVolume'">
      <div class="gg-field">
        <label class="gg-field-label" for="command-audio-volume-delta">{{ t("command.audioVolume.delta") }}</label>
        <input
          id="command-audio-volume-delta"
          class="gg-input cmd-editor__number-input"
          type="number"
          min="-20"
          max="20"
          step="1"
          :value="asVolume.delta"
          @input="updateVolumeDelta"
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

.cmd-editor > .gg-field,
.cmd-editor .gg-field {
  min-width: 0;
}

.cmd-editor__type {
  max-width: 260px;
}

.cmd-editor__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cmd-editor .gg-check-row {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
}

.cmd-editor .gg-check-row label {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  cursor: pointer;
}

.cmd-editor__field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cmd-editor__help-button {
  min-width: 40px;
  padding-inline: 10px;
}

.cmd-editor__help-button :deep(svg) {
  width: 18px;
  height: 18px;
}

.cmd-editor__textarea {
  resize: vertical;
}

.cmd-editor__code {
  min-height: 96px;
  resize: vertical;
}

.cmd-editor__number-input {
  max-width: 160px;
}

.cmd-editor__syntax-error {
  margin-top: 8px;
}

.cmd-editor__syntax-guide {
  color: var(--gg-text);
  line-height: 1.65;
}

.cmd-editor__syntax-guide pre {
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface-muted);
  color: var(--gg-text);
  font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
}

</style>
