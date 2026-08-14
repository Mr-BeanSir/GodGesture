<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 1 });
</script>

<template>
  <div class="gg-skeleton-stack" aria-hidden="true">
    <div v-for="row in rows" :key="row" class="gg-skeleton" :style="{ width: row === rows ? '68%' : '100%' }" />
  </div>
</template>
