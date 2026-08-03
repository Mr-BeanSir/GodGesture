<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { GestureInput, GestureSpec } from "@godgesture/shared";
import {
  BUTTON_SYMBOLS,
  DIRECTION_ARROWS,
  gestureModifierInput,
  TRIGGER_SYMBOLS,
  gestureInputs,
} from "../utils/mnemonic";
import WheelModifierIcon from "./WheelModifierIcon.vue";

const props = defineProps<{ gesture: GestureSpec }>();
const { t } = useI18n();

const triggerSymbol = computed(() => TRIGGER_SYMBOLS[props.gesture.trigger]);
const inputs = computed(() => {
  const base = gestureInputs(props.gesture);
  const modifier = gestureModifierInput(props.gesture.modifier);
  return modifier ? [...base, modifier] : base;
});

function inputLabel(input: GestureInput): string {
  if (input.type === "stroke") return input.direction;
  if (input.type === "wheel") return t(`modifier.${input.direction === "forward" ? "wheelForward" : "wheelBackward"}`);
  return t(`modifier.${input.button === "x1" ? "x1Down" : input.button === "x2" ? "x2Down" : `${input.button}ButtonDown`}`);
}
</script>

<template>
  <span class="mnemonic">
    <span class="mnemonic__trigger">{{ triggerSymbol }}</span>
    <span v-for="(input, index) in inputs" :key="`${input.type}-${index}`" class="mnemonic__input">
      <span v-if="input.type === 'stroke'" :aria-label="inputLabel(input)">
        {{ DIRECTION_ARROWS[input.direction] }}
      </span>
      <WheelModifierIcon
        v-else-if="input.type === 'wheel'"
        :direction="input.direction === 'forward' ? 'up' : 'down'"
        :label="inputLabel(input)"
      />
      <WheelModifierIcon
        v-else-if="input.button === 'middle'"
        pressed
        :label="inputLabel(input)"
      />
      <span v-else :aria-label="inputLabel(input)">{{ BUTTON_SYMBOLS[input.button] }}</span>
    </span>
  </span>
</template>

<style scoped>
.mnemonic {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  letter-spacing: 1px;
  flex-wrap: wrap;
}
.mnemonic__trigger {
  color: var(--el-color-primary);
}
.mnemonic__input {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-primary);
  letter-spacing: 0;
}
</style>
