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
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  const saveState = ref<SaveState>("idle");
  const paused = ref(false);

  /** 最后一次从后端读取或成功写入的规范化配置，用于跳过载入造成的伪改动。 */
  let lastPersistedDoc: string | null = null;
  let lastPersistedMachine: string | null = null;
  let docSaveQueue = Promise.resolve();
  let machineSaveQueue = Promise.resolve();

  function serializedDoc(): string | null {
    if (!doc.value) return null;
    const parsed = ConfigDocument.safeParse(doc.value);
    return parsed.success ? JSON.stringify(parsed.data) : null;
  }

  function serializedMachine(): string | null {
    if (!machine.value) return null;
    const parsed = MachineLocalSettings.safeParse(machine.value);
    return parsed.success ? JSON.stringify(parsed.data) : null;
  }

  function hasPendingChanges() {
    return (
      (doc.value !== null && serializedDoc() !== lastPersistedDoc) ||
      (machine.value !== null && serializedMachine() !== lastPersistedMachine)
    );
  }

  async function load() {
    if (loading.value) return;
    loading.value = true;
    loadError.value = null;
    ready.value = false;
    try {
      const [d, m, p] = await Promise.all([
        backend.configGet(),
        backend.machineGet(),
        backend.engineIsPaused(),
      ]);
      const parsedDoc = ConfigDocument.parse(d);
      const parsedMachine = MachineLocalSettings.parse(m);
      lastPersistedDoc = JSON.stringify(parsedDoc);
      lastPersistedMachine = JSON.stringify(parsedMachine);
      doc.value = parsedDoc;
      machine.value = parsedMachine;
      paused.value = p;
      saveState.value = "idle";
      ready.value = true;
    } catch (err) {
      doc.value = null;
      machine.value = null;
      loadError.value = err instanceof Error ? err.message : String(err);
      console.error("[config] initial load failed", err);
    } finally {
      loading.value = false;
    }
  }

  async function persistDocNow() {
    if (!doc.value) return;
    const parsed = ConfigDocument.safeParse(doc.value);
    if (!parsed.success) {
      saveState.value = "error";
      console.warn("[config] validation failed", parsed.error.issues);
      return;
    }
    const serialized = JSON.stringify(parsed.data);
    if (serialized === lastPersistedDoc) return;
    saveState.value = "saving";
    try {
      await backend.configSet(parsed.data);
      lastPersistedDoc = serialized;
      saveState.value = hasPendingChanges() ? "saving" : "saved";
    } catch (err) {
      saveState.value = "error";
      console.error("[config] config_set failed", err);
    }
  }

  function persistDoc() {
    docSaveQueue = docSaveQueue.then(persistDocNow, persistDocNow);
    return docSaveQueue;
  }

  async function persistMachineNow() {
    if (!machine.value) return;
    const parsed = MachineLocalSettings.safeParse(machine.value);
    if (!parsed.success) {
      saveState.value = "error";
      return;
    }
    const serialized = JSON.stringify(parsed.data);
    if (serialized === lastPersistedMachine) return;
    saveState.value = "saving";
    try {
      await backend.machineSet(parsed.data);
      lastPersistedMachine = serialized;
      saveState.value = hasPendingChanges() ? "saving" : "saved";
    } catch (err) {
      saveState.value = "error";
      console.error("[config] machine_set failed", err);
    }
  }

  function persistMachine() {
    machineSaveQueue = machineSaveQueue.then(persistMachineNow, persistMachineNow);
    return machineSaveQueue;
  }

  // 改动自动保存(防抖 500ms)
  watchDebounced(
    doc,
    () => {
      void persistDoc();
    },
    { deep: true, debounce: 500 },
  );

  watchDebounced(
    machine,
    () => {
      void persistMachine();
    },
    { deep: true, debounce: 300 },
  );

  // 有改动立刻进入 saving 展示(先于防抖落盘)
  watch(
    doc,
    () => {
      if (serializedDoc() !== lastPersistedDoc) saveState.value = "saving";
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
    loading,
    loadError,
    saveState,
    paused,
    preferences,
    load,
    togglePause,
  };
});
