<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { GestureInput, GestureSpec } from "@godgesture/shared";
import {
  gestureModifierInput,
  gestureInputs,
} from "../utils/mnemonic";
import MnemonicToken from "./MnemonicToken.vue";
import MnemonicTrigger from "./MnemonicTrigger.vue";

const props = defineProps<{ gesture: GestureSpec }>();
const { t } = useI18n();

const baseInputs = computed(() => gestureInputs(props.gesture));
const modifierInput = computed(() => gestureModifierInput(props.gesture.modifier));
const inputs = computed(() => {
  return modifierInput.value ? [...baseInputs.value, modifierInput.value] : baseInputs.value;
});

function inputLabel(input: GestureInput): string {
  if (input.type === "stroke") return t(`actions.token.stroke.${input.direction}`);
  if (input.type === "key") return input.key;
  if (input.type === "wheel") return t(`modifier.${input.direction === "forward" ? "wheelForward" : "wheelBackward"}`);
  return t(`modifier.${input.button === "x1" ? "x1Down" : input.button === "x2" ? "x2Down" : `${input.button}ButtonDown`}`);
}

const ariaLabel = computed(() =>
  [props.gesture.trigger, ...inputs.value.map(inputLabel)].join(" "),
);
</script>

<template>
  <span
    class="mnemonic"
    role="img"
    :aria-label="ariaLabel"
    :title="ariaLabel"
  >
    <MnemonicTrigger :trigger="gesture.trigger" />
    <span
      v-for="(input, index) in inputs"
      :key="`${input.type}-${index}`"
      class="mnemonic__input"
      :class="{ 'mnemonic__input--modifier': index >= baseInputs.length }"
    >
      <MnemonicToken :token="input" :label="inputLabel(input)" />
    </span>
  </span>
</template>

<style scoped>
.mnemonic {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 5px;
  flex-wrap: wrap;
  color: var(--el-text-color-primary);
}

.mnemonic__input {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--el-text-color-primary);
}

.mnemonic__input--modifier {
  --wheel-modifier-accent: var(--el-color-warning);
  color: var(--el-color-warning);
}

.mnemonic__input--modifier :deep(.mnemonic-token),
.mnemonic__input--modifier :deep(.mnemonic-icon) {
  color: var(--el-color-warning);
}
</style>
