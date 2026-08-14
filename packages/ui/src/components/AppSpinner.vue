<script setup lang="ts">
import { LoaderCircle } from "lucide-vue-next";

withDefaults(defineProps<{ label?: string; size?: "sm" | "md" }>(), { label: "", size: "md" });
</script>

<template>
  <span :class="['gg-spinner', `gg-spinner--${size}`]" role="status">
    <LoaderCircle class="gg-spinner__icon" aria-hidden="true" />
    <span v-if="label">{{ label }}</span>
  </span>
</template>
