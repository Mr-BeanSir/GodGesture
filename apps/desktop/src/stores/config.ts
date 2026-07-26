/**
 * 配置 store:持有 ConfigDocument 与 MachineLocalSettings,
 * 深度侦听改动 -> 防抖 500ms -> zod 校验 -> config_set(保存并即时生效)。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import { ConfigDocument, MachineLocalSettings } from "@godgesture/shared";
import { useBackend } from "../api/backend";

export type SaveState = "idle" | "saving" | "saved" | "error";

export const useConfigStore = defineStore("config", () => {
  const backend = useBackend();

  const doc = ref<ConfigDocument | null>(null);
  const machine = ref<MachineLocalSettings | null>(null);
  const ready = ref(false);
  const saveState = ref<SaveState>("idle");
  const paused = ref(false);

  /** 加载期间抑制自动保存 */
  let suppressAutoSave = true;

  async function load() {
    suppressAutoSave = true;
    const [d, m, p] = await Promise.all([
      backend.configGet(),
      backend.machineGet(),
      backend.engineIsPaused(),
    ]);
    doc.value = ConfigDocument.parse(d);
    machine.value = MachineLocalSettings.parse(m);
    paused.value = p;
    ready.value = true;
    // 等本轮响应式刷新结束后再放开自动保存
    setTimeout(() => {
      suppressAutoSave = false;
    }, 0);
  }

  async function persistDoc() {
    if (!doc.value) return;
    const parsed = ConfigDocument.safeParse(doc.value);
    if (!parsed.success) {
      saveState.value = "error";
      console.warn("[config] validation failed", parsed.error.issues);
      return;
    }
    saveState.value = "saving";
    try {
      await backend.configSet(parsed.data);
      saveState.value = "saved";
    } catch (err) {
      saveState.value = "error";
      console.error("[config] config_set failed", err);
    }
  }

  async function persistMachine() {
    if (!machine.value) return;
    const parsed = MachineLocalSettings.safeParse(machine.value);
    if (!parsed.success) {
      saveState.value = "error";
      return;
    }
    saveState.value = "saving";
    try {
      await backend.machineSet(parsed.data);
      saveState.value = "saved";
    } catch (err) {
      saveState.value = "error";
      console.error("[config] machine_set failed", err);
    }
  }

  // 改动自动保存(防抖 500ms)
  watchDebounced(
    doc,
    () => {
      if (suppressAutoSave) return;
      void persistDoc();
    },
    { deep: true, debounce: 500 },
  );

  watchDebounced(
    machine,
    () => {
      if (suppressAutoSave) return;
      void persistMachine();
    },
    { deep: true, debounce: 300 },
  );

  // 有改动立刻进入 saving 展示(先于防抖落盘)
  watch(
    doc,
    () => {
      if (!suppressAutoSave) saveState.value = "saving";
    },
    { deep: true },
  );

  async function togglePause() {
    paused.value = await backend.engineTogglePause();
  }

  const preferences = computed(() => doc.value?.preferences ?? null);

  return {
    backend,
    doc,
    machine,
    ready,
    saveState,
    paused,
    preferences,
    load,
    togglePause,
  };
});
