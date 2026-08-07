<script setup lang="ts">
const spriteUrl = new URL(
  "../../../../packages/shared/src/assets/mnemonic.svg",
  import.meta.url,
).href;

defineProps<{
  symbol: string;
  viewBox: string;
}>();
</script>

<template>
  <svg class="mnemonic-icon" :viewBox="viewBox" role="presentation" aria-hidden="true">
    <use :href="`${spriteUrl}#${symbol}`" />
  </svg>
</template>

<style scoped>
.mnemonic-icon {
  display: block;
  overflow: visible;
}
</style>
