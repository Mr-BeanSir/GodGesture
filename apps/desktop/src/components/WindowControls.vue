<script setup lang="ts">
import { Minus, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { closeSettingsWindow, minimizeSettingsWindow } from "../window-controls";
import { appLog } from "../logging";

const { t } = useI18n();

async function minimizeWindow() {
  try {
    await minimizeSettingsWindow();
  } catch (error) {
    appLog.warn("window", `最小化设置窗口失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function closeWindow() {
  try {
    await closeSettingsWindow();
  } catch (error) {
    appLog.warn("window", `关闭设置窗口失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
</script>

<template>
  <div class="window-controls" role="group" :aria-label="t('header.windowControls')">
    <button
      type="button"
      class="window-controls__button"
      :aria-label="t('header.minimize')"
      :title="t('header.minimize')"
      @click="minimizeWindow"
    >
      <Minus :size="16" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="window-controls__button window-controls__button--close"
      :aria-label="t('header.close')"
      :title="t('header.close')"
      @click="closeWindow"
    >
      <X :size="16" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  align-self: stretch;
  display: flex;
  flex: 0 0 auto;
  height: 48px;
  margin-left: 10px;
  border-left: 1px solid var(--gg-border);
}

.window-controls__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 48px;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--gg-text);
  background: transparent;
  cursor: default;
}

.window-controls__button:hover {
  background: var(--gg-title-control-hover);
}

.window-controls__button:active {
  background: var(--gg-title-control-active);
}

.window-controls__button:focus-visible {
  position: relative;
  z-index: 1;
  outline: 0;
  box-shadow: inset 0 0 0 2px var(--gg-ring);
}

.window-controls__button--close:hover {
  color: var(--gg-window-close-foreground);
  background: var(--gg-window-close-hover);
}

.window-controls__button--close:active {
  color: var(--gg-window-close-foreground);
  background: var(--gg-window-close-active);
}

.window-controls__button--close:focus-visible {
  box-shadow: inset 0 0 0 2px currentColor;
}

</style>
