<script setup lang="ts">
import { computed } from "vue";
import type { BoundaryToken, GestureInput } from "@godgesture/shared";
import MnemonicIcon from "./MnemonicIcon.vue";
import WheelModifierIcon from "./WheelModifierIcon.vue";

type Token = GestureInput | BoundaryToken;

const props = defineProps<{
  token: Token;
  label: string;
}>();

const keyText = computed(() => {
  if (props.token.type !== "key") return "";
  const key = props.token.key;
  if (key.startsWith("Key") && key.length === 4) return key.slice(3);
  if (key.startsWith("Digit") && key.length === 6) return key.slice(5);
  if (key.startsWith("Numpad")) return `Num${key.slice(6)}`;
  if (key.startsWith("Arrow")) return key.slice(5);
  if (key.startsWith("Control")) return `Ctrl${key.slice(7)}`;
  if (key.startsWith("Meta")) return `Meta${key.slice(4)}`;
  return key;
});

const strokeSymbols: Record<Extract<Token, { type: "stroke" }>['direction'], string> = {
  up: "stroke-up",
  rightUp: "stroke-right-up",
  right: "stroke-right",
  rightDown: "stroke-right-down",
  down: "stroke-down",
  leftDown: "stroke-left-down",
  left: "stroke-left",
  leftUp: "stroke-left-up",
};
</script>

<template>
  <span class="mnemonic-token" :title="label">
    <MnemonicIcon
      v-if="token.type === 'stroke'"
      :symbol="strokeSymbols[token.direction]"
      view-box="0 0 24 24"
      class="mnemonic-token__svg"
    />

    <WheelModifierIcon
      v-else-if="token.type === 'wheel'"
      :direction="token.direction === 'forward' ? 'up' : 'down'"
      :label="label"
    />

    <MnemonicIcon
      v-else-if="token.type === 'button'"
      :symbol="`button-${token.button}`"
      view-box="0 0 24 24"
      class="mnemonic-token__svg"
    />

    <kbd v-else class="mnemonic-token__key" :aria-label="label">
      {{ keyText }}
    </kbd>
  </span>
</template>

<style scoped>
.mnemonic-token {
  display: inline-flex;
  align-items: center;
  height: 1.35em;
  min-width: 0;
  flex: 0 0 auto;
  color: var(--el-color-primary);
  line-height: 1;
  vertical-align: middle;
}

.mnemonic-token__svg {
  display: block;
  width: 1.35em;
  height: 100%;
  flex: 0 0 auto;
  overflow: visible;
}

.mnemonic-token__key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-width: 1.2em;
  padding: 0 0.28em;
  border: 1px solid var(--el-border-color);
  border-radius: 3px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 0.72em;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
