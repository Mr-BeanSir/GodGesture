<script setup lang="ts">
import { computed } from "vue";
import MnemonicIcon from "./MnemonicIcon.vue";

const props = defineProps<{
  direction?: "up" | "down";
  pressed?: boolean;
  label?: string;
}>();

const symbol = computed(() =>
  `wheel-${props.direction ?? "up"}${props.pressed ? "-pressed" : ""}`,
);
</script>

<template>
  <MnemonicIcon
    :symbol="symbol"
    view-box="0 0 32 48"
    class="wheel-modifier-icon"
    role="img"
    :aria-label="props.label"
    :aria-hidden="props.label ? undefined : true"
  />
</template>

<style scoped>
.wheel-modifier-icon {
  display: inline-block;
  width: 0.9em;
  height: 1.35em;
  flex: 0 0 auto;
  overflow: visible;
  vertical-align: middle;
}
</style>
