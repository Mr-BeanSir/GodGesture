<script setup lang="ts">
/**
 * 命令编辑器:编辑一条 Command 判别联合。
 * 对外 v-model 为 Command;切换类型时用 createDefaultCommand 生成默认值。
 * 被「手势」区(手势意图)与「触发角 & 摩擦边」区共用。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Delete, Plus } from "@element-plus/icons-vue";
import type { Command } from "@godgesture/shared";
import {
  COMMAND_TYPES,
  WINDOW_OPERATIONS,
  createDefaultCommand,
  type CommandType,
  type CommandOfType,
} from "../utils/commands";
import HotkeyInput from "./HotkeyInput.vue";
import NodePluginPicker from "./NodePluginPicker.vue";
import type { HotkeyChord } from "./hotkey-recorder";
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
        actionId: plugin?.actions[0]?.id ?? "default",
      });
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
const asVolume = computed(() => props.modelValue as CommandOfType<"audioVolume">);

type SendTextCommand = CommandOfType<"sendText">;
type SendTextStep = NonNullable<SendTextCommand["steps"]>[number];

/** Keep old SendKeys strings readable until the user edits the operation list. */
const sendTextSteps = computed<SendTextStep[]>(() => {
  if (Array.isArray(asSendText.value.steps)) return asSendText.value.steps;
  if (asSendText.value.text !== undefined) {
    return [{ type: "text", text: asSendText.value.text }];
  }
  return [];
});

function editableSendTextSteps(): SendTextStep[] {
  return sendTextSteps.value.map((step) =>
    step.type === "text"
      ? { ...step }
      : { ...step, modifiers: [...step.modifiers] },
  );
}

function updateSendTextSteps(steps: SendTextStep[]) {
  patch({ steps, text: undefined });
}

function addSendTextStep() {
  updateSendTextSteps([
    ...editableSendTextSteps(),
    { type: "text", text: "" },
  ]);
}

function removeSendTextStep(index: number) {
  const steps = editableSendTextSteps();
  steps.splice(index, 1);
  updateSendTextSteps(steps);
}

function changeSendTextStepType(index: number, value: unknown) {
  if (value !== "text" && value !== "key") return;
  const steps = editableSendTextSteps();
  steps[index] = value === "text"
    ? { type: "text", text: "" }
    : { type: "key", modifiers: [], key: "enter" };
  updateSendTextSteps(steps);
}

function updateSendTextStepText(index: number, text: string) {
  const steps = editableSendTextSteps();
  const step = steps[index];
  if (!step || step.type !== "text") return;
  step.text = text;
  updateSendTextSteps(steps);
}

function updateSendTextStepKey(index: number, value: HotkeyChord) {
  const key = value.keys[0];
  if (!key) return;
  const steps = editableSendTextSteps();
  const step = steps[index];
  if (!step || step.type !== "key") return;
  step.modifiers = [...value.modifiers];
  step.key = key;
  updateSendTextSteps(steps);
}

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
          @complete="patch({ modifiers: $event.modifiers, keys: $event.keys })"
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

    <!-- 按键/文字序列 -->
    <template v-else-if="type === 'sendText'">
      <div class="gg-field">
        <label class="gg-field-label">{{ t("command.sendText.sequence") }}</label>
        <div class="cmd-editor__send-text-steps">
          <p v-if="sendTextSteps.length === 0" class="gg-hint">
            {{ t("command.sendText.empty") }}
          </p>
          <div
            v-for="(step, index) in sendTextSteps"
            :key="index"
            class="cmd-editor__send-text-step"
          >
            <span class="cmd-editor__step-index">{{ index + 1 }}</span>
            <el-select
              class="cmd-editor__step-type"
              :model-value="step.type"
              @update:model-value="changeSendTextStepType(index, $event)"
            >
              <el-option :label="t('command.sendText.textType')" value="text" />
              <el-option :label="t('command.sendText.keyType')" value="key" />
            </el-select>
            <el-input
              v-if="step.type === 'text'"
              class="cmd-editor__step-value"
              :model-value="step.text"
              :placeholder="t('command.sendText.textPlaceholder')"
              @update:model-value="updateSendTextStepText(index, $event)"
            />
            <HotkeyInput
              v-else
              class="cmd-editor__step-value"
              :modifiers="step.modifiers"
              :keys="[step.key]"
              @complete="updateSendTextStepKey(index, $event)"
            />
            <el-tooltip :content="t('command.sendText.removeStep')">
              <el-button
                link
                type="danger"
                :icon="Delete"
                :aria-label="t('command.sendText.removeStep')"
                @click="removeSendTextStep(index)"
              />
            </el-tooltip>
          </div>
          <el-button size="small" :icon="Plus" @click="addSendTextStep">
            {{ t("command.sendText.addStep") }}
          </el-button>
        </div>
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

    <!-- Node 插件 -->
    <NodePluginPicker
      v-else-if="type === 'nodePlugin'"
      :model-value="asNodePlugin"
      @update:model-value="emit('update:modelValue', $event)"
    />

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
.cmd-editor__type {
  max-width: 260px;
}
.cmd-editor__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cmd-editor__send-text-steps {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}
.cmd-editor__send-text-step {
  display: grid;
  min-width: 0;
  grid-template-columns: 24px minmax(84px, 110px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}
.cmd-editor__step-index {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: right;
}
.cmd-editor__step-type,
.cmd-editor__step-value {
  min-width: 0;
  width: 100%;
}
@media (max-width: 560px) {
  .cmd-editor__send-text-step {
    grid-template-columns: 24px minmax(0, 1fr) auto;
  }
  .cmd-editor__step-type {
    grid-column: 2;
  }
  .cmd-editor__step-value {
    grid-column: 2;
  }
}
</style>
