<script setup lang="ts">
import { computed } from "vue";
import type { GestureSpec } from "@godgesture/shared";
import { TRIGGER_SYMBOLS, strokesMnemonic, MODIFIER_SYMBOLS } from "../utils/mnemonic";

const props = defineProps<{ gesture: GestureSpec }>();

const triggerSymbol = computed(() => TRIGGER_SYMBOLS[props.gesture.trigger]);
const arrows = computed(() => strokesMnemonic(props.gesture.strokes));
const modifierSymbol = computed(() =>
  props.gesture.modifier !== "none" ? MODIFIER_SYMBOLS[props.gesture.modifier] : "",
);
</script>

<template>
  <span class="mnemonic">
    <span class="mnemonic__trigger">{{ triggerSymbol }}</span>
    <span class="mnemonic__arrows">{{ arrows }}</span>
    <span v-if="modifierSymbol" class="mnemonic__modifier">+{{ modifierSymbol }}</span>
  </span>
</template>

<style scoped>
.mnemonic {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  letter-spacing: 2px;
  white-space: nowrap;
}
.mnemonic__trigger {
  color: var(--el-color-primary);
}
.mnemonic__arrows {
  color: var(--el-text-color-primary);
}
.mnemonic__modifier {
  color: var(--el-color-warning);
  letter-spacing: 0;
}
</style>
