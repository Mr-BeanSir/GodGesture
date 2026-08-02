<script setup lang="ts">
defineProps<{
  direction?: "up" | "down";
  /** 滚轮按下时突出中央按键区域。 */
  pressed?: boolean;
  label?: string;
}>();
</script>

<template>
  <svg
    class="wheel-modifier-icon"
    viewBox="0 0 32 48"
    role="img"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  >
    <rect class="wheel-modifier-icon__body" x="6" y="2" width="20" height="44" rx="10" />
    <path class="wheel-modifier-icon__groove" d="M16 15v18" />
    <rect
      v-if="direction === 'up'"
      class="wheel-modifier-icon__active"
      x="7.5"
      y="6"
      width="17"
      height="5"
      rx="2.5"
    />
    <rect
      v-else-if="direction === 'down'"
      class="wheel-modifier-icon__active"
      x="7.5"
      y="37"
      width="17"
      height="5"
      rx="2.5"
    />
    <rect
      v-if="pressed"
      class="wheel-modifier-icon__pressed"
      x="10"
      y="20"
      width="12"
      height="8"
      rx="4"
    />
  </svg>
</template>

<style scoped>
.wheel-modifier-icon {
  display: inline-block;
  width: 0.72em;
  height: 1.08em;
  vertical-align: -0.18em;
  overflow: visible;
}

.wheel-modifier-icon__body {
  fill: var(--el-fill-color-light);
  stroke: var(--el-text-color-secondary);
  stroke-width: 1.5;
}

.wheel-modifier-icon__groove {
  fill: none;
  stroke: var(--el-border-color);
  stroke-width: 1.25;
  stroke-linecap: round;
}

.wheel-modifier-icon__active {
  fill: var(--el-color-primary);
}

.wheel-modifier-icon__pressed {
  fill: var(--el-color-primary);
  stroke: var(--el-color-primary);
  stroke-width: 0.75;
}
</style>
