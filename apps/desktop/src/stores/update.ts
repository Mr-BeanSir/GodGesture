import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import {
  BackendError,
  useBackend,
  type UpdateMetadata,
} from "../api/backend";
import { useConfigStore } from "./config";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "current"
  | "failed";

export const useUpdateStore = defineStore("update", () => {
  const backend = useBackend();
  const config = useConfigStore();
  const state = ref<UpdateState>("idle");
  const metadata = ref<UpdateMetadata | null>(null);
  const errorCode = ref<string | null>(null);
  const downloaded = ref(0);
  const total = ref<number | null>(null);
  const automaticPromptPending = ref(false);

  let checkRequest: Promise<UpdateMetadata | null> | null = null;
  let automaticTimer: ReturnType<typeof setTimeout> | null = null;
  const promptedVersions = new Set<string>();

  const progress = computed(() => {
    if (!total.value || total.value <= 0) return null;
    return Math.min(100, Math.round((downloaded.value / total.value) * 100));
  });

  onScopeDispose(() => {
    if (automaticTimer) clearTimeout(automaticTimer);
    automaticTimer = null;
  });

  function normalizedErrorCode(error: unknown, fallback: string) {
    return error instanceof BackendError ? error.code : fallback;
  }

  async function check(automatic = false) {
    if (checkRequest) return checkRequest;
    const request = (async () => {
      state.value = "checking";
      errorCode.value = null;
      try {
        const result = await backend.updateCheck();
        metadata.value = result;
        if (!result) {
          state.value = "current";
          automaticPromptPending.value = false;
          return null;
        }
        state.value = "available";
        if (automatic && !promptedVersions.has(result.version)) {
          promptedVersions.add(result.version);
          automaticPromptPending.value = true;
        }
        return result;
      } catch (error) {
        state.value = "failed";
        errorCode.value = normalizedErrorCode(error, "update_check_failed");
        return null;
      }
    })();
    checkRequest = request;
    try {
      return await request;
    } finally {
      if (checkRequest === request) checkRequest = null;
    }
  }

  function scheduleAutomaticCheck(enabled: boolean, delayMs = 3_000) {
    if (automaticTimer) clearTimeout(automaticTimer);
    automaticTimer = null;
    if (!enabled) return;
    automaticTimer = setTimeout(() => {
      automaticTimer = null;
      void check(true);
    }, delayMs);
  }

  function dismissAutomaticPrompt() {
    automaticPromptPending.value = false;
  }

  async function install() {
    if (!metadata.value || state.value === "downloading" || state.value === "restarting") {
      return false;
    }
    errorCode.value = null;
    downloaded.value = 0;
    total.value = null;
    try {
      await config.flushPendingSaves();
      state.value = "downloading";
      await backend.updateInstall((event) => {
        if (event.event === "started") {
          total.value = event.data.contentLength;
        } else if (event.event === "progress") {
          downloaded.value = event.data.downloaded;
        } else {
          downloaded.value = event.data.downloaded;
          state.value = "restarting";
        }
      });
      state.value = "ready";
      return true;
    } catch (error) {
      state.value = "failed";
      errorCode.value = normalizedErrorCode(error, "update_install_failed");
      return false;
    }
  }

  async function cancel() {
    try {
      await backend.updateCancel();
      metadata.value = null;
      automaticPromptPending.value = false;
      state.value = "idle";
      errorCode.value = null;
    } catch (error) {
      state.value = "failed";
      errorCode.value = normalizedErrorCode(error, "update_cancel_failed");
    }
  }

  return {
    state,
    metadata,
    errorCode,
    downloaded,
    total,
    progress,
    automaticPromptPending,
    check,
    scheduleAutomaticCheck,
    dismissAutomaticPrompt,
    install,
    cancel,
  };
});
