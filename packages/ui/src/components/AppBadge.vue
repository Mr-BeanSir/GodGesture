<script setup lang="ts">
withDefaults(defineProps<{ variant?: "neutral" | "info" | "success" | "warning" | "danger" }>(), {
  variant: "neutral",
});
</script>

<template>
  <span :class="['gg-badge', `gg-badge--${variant}`]"><slot /></span>
</template>
