<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type * as Monaco from "monaco-editor/editor/editor.api";
import { loadMonaco } from "../script/monaco";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: "js" | "lua";
    editorLabel: string;
    height?: number;
  }>(),
  { language: "js", height: 160 },
);
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();

const container = ref<HTMLElement>();
const loading = ref(true);
const loadFailed = ref(false);
const editorHeight = computed(() => `${Math.max(120, props.height)}px`);

let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
let model: Monaco.editor.ITextModel | undefined;
let resizeObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let disposed = false;
let applyingExternalValue = false;

function editorLanguage(language: "js" | "lua") {
  return language === "js" ? "javascript" : "lua";
}

function currentTheme() {
  return document.documentElement.classList.contains("dark") ? "vs-dark" : "vs";
}

onMounted(async () => {
  let monaco: Awaited<ReturnType<typeof loadMonaco>>;
  try {
    monaco = await loadMonaco();
  } catch (error) {
    if (disposed) return;
    console.error("Monaco editor failed to load", error);
    loading.value = false;
    loadFailed.value = true;
    return;
  }
  if (disposed || !container.value) return;

  const modelId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  model = monaco.editor.createModel(
    props.modelValue,
    editorLanguage(props.language),
    monaco.Uri.parse(`inmemory://godgesture/script/${modelId}.js`),
  );
  editor = monaco.editor.create(container.value, {
    model,
    ariaLabel: props.editorLabel,
    automaticLayout: false,
    fontFamily: '"Cascadia Code", "Consolas", monospace',
    fontSize: 13,
    lineNumbersMinChars: 3,
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    padding: { top: 8, bottom: 8 },
    parameterHints: { enabled: true },
    quickSuggestions: { other: "on", comments: "off", strings: "off" },
    renderLineHighlight: "line",
    scrollBeyondLastLine: false,
    suggest: { showWords: false },
    suggestOnTriggerCharacters: true,
    tabSize: 2,
    theme: currentTheme(),
    wordWrap: "on",
  });
  editor.onDidChangeModelContent(() => {
    if (!applyingExternalValue && model) emit("update:modelValue", model.getValue());
  });

  resizeObserver = new ResizeObserver(() => editor?.layout());
  resizeObserver.observe(container.value);
  themeObserver = new MutationObserver(() => monaco.editor.setTheme(currentTheme()));
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  loading.value = false;
});

watch(
  () => props.modelValue,
  (value) => {
    if (!model || model.getValue() === value) return;
    applyingExternalValue = true;
    model.setValue(value);
    applyingExternalValue = false;
  },
);

watch(
  () => props.language,
  async (language) => {
    if (!model) return;
    const monaco = await loadMonaco();
    monaco.editor.setModelLanguage(model, editorLanguage(language));
  },
);

watch(
  () => props.editorLabel,
  (editorLabel) => editor?.updateOptions({ ariaLabel: editorLabel }),
);

onBeforeUnmount(() => {
  disposed = true;
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  editor?.dispose();
  model?.dispose();
});
</script>

<template>
  <el-input
    v-if="loadFailed"
    type="textarea"
    :rows="Math.max(5, Math.round(props.height / 24))"
    :model-value="modelValue"
    :aria-label="editorLabel"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <div
    v-else
    ref="container"
    v-loading="loading"
    class="script-editor"
    :style="{ height: editorHeight }"
  />
</template>

<style scoped>
.script-editor {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
}
.script-editor:focus-within {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
</style>
