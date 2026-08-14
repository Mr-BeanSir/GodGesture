<script setup lang="ts">
import { Inbox } from "lucide-vue-next";

defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="gg-empty">
    <Inbox class="gg-empty__icon" aria-hidden="true" />
    <div class="gg-empty__title">{{ title }}</div>
    <p v-if="description" class="gg-empty__description">{{ description }}</p>
    <slot />
  </div>
</template>
