/**
 * 配置 store:持有 ConfigDocument 与 MachineLocalSettings,
 * 深度侦听改动 -> 防抖 500ms -> zod 校验 -> config_set(保存并即时生效)。
 */
import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, watch } from "vue";
import {
  ConfigDocument,
  MachineLocalSettings,
  type LegacyImportResult,
} from "@godgesture/shared";
import { BackendError, useBackend } from "../api/backend";

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
  let docSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let machineSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveGeneration = 0;
  let applyingImport = false;
  let unlistenPause: (() => void) | null = null;
  let pauseEventVersion = 0;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
    clearSaveTimers();
    unlistenPause?.();
    unlistenPause = null;
  });

  async function ensurePauseListener() {
    if (unlistenPause) return;
    const unlisten = await backend.onPauseChanged((next) => {
      pauseEventVersion += 1;
      paused.value = next;
    });
    if (disposed) unlisten();
    else unlistenPause = unlisten;
  }

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
      try {
        await ensurePauseListener();
      } catch (err) {
        console.error("[config] pause listener setup failed", err);
      }
      const pauseVersionAtRead = pauseEventVersion;
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
      if (pauseEventVersion === pauseVersionAtRead) paused.value = p;
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
      throw new Error("config validation failed");
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
      throw err;
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
      throw new Error("machine settings validation failed");
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
      throw err;
    }
  }

  function persistMachine() {
    machineSaveQueue = machineSaveQueue.then(persistMachineNow, persistMachineNow);
    return machineSaveQueue;
  }

  function clearSaveTimers() {
    if (docSaveTimer) clearTimeout(docSaveTimer);
    if (machineSaveTimer) clearTimeout(machineSaveTimer);
    docSaveTimer = null;
    machineSaveTimer = null;
  }

  function scheduleDocSave() {
    if (applyingImport) return;
    if (docSaveTimer) clearTimeout(docSaveTimer);
    const generation = saveGeneration;
    docSaveTimer = setTimeout(() => {
      docSaveTimer = null;
      if (!applyingImport && generation === saveGeneration) {
        void persistDoc().catch(() => undefined);
      }
    }, 500);
  }

  function scheduleMachineSave() {
    if (applyingImport) return;
    if (machineSaveTimer) clearTimeout(machineSaveTimer);
    const generation = saveGeneration;
    machineSaveTimer = setTimeout(() => {
      machineSaveTimer = null;
      if (!applyingImport && generation === saveGeneration) {
        void persistMachine().catch(() => undefined);
      }
    }, 300);
  }

  watch(
    doc,
    () => {
      if (serializedDoc() !== lastPersistedDoc) saveState.value = "saving";
      scheduleDocSave();
    },
    { deep: true },
  );

  watch(
    machine,
    () => {
      if (serializedMachine() !== lastPersistedMachine) saveState.value = "saving";
      scheduleMachineSave();
    },
    { deep: true },
  );

  async function flushPendingSaves() {
    clearSaveTimers();
    saveGeneration += 1;
    await Promise.all([persistDoc(), persistMachine()]);
  }

  async function applyLegacyImport(result: LegacyImportResult) {
    if (!doc.value || !machine.value) throw new Error("config is not ready");
    const importedDoc = ConfigDocument.parse(result.document);
    const importedMachine = MachineLocalSettings.parse(result.machineLocal);
    const nextMachine = MachineLocalSettings.parse({
      ...machine.value,
      autoStart: importedMachine.autoStart,
      trayIconVisible: importedMachine.trayIconVisible,
    });

    applyingImport = true;
    clearSaveTimers();
    saveGeneration += 1;
    try {
      await flushPendingSaves();
      await backend.legacyImportApply(importedDoc, nextMachine);

      lastPersistedDoc = JSON.stringify(importedDoc);
      lastPersistedMachine = JSON.stringify(nextMachine);
      doc.value = importedDoc;
      machine.value = nextMachine;
      saveState.value = "saved";
    } catch (err) {
      if (err instanceof BackendError && err.code === "rollback_incomplete") {
        await load();
      }
      throw err;
    } finally {
      applyingImport = false;
      saveGeneration += 1;
    }
  }

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
    applyLegacyImport,
  };
});
