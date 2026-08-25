<script setup lang="ts">
import AppDialog from "./AppDialog.vue";

export interface AppChoiceItem {
  id: string;
  title: string;
  description?: string;
}

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    closeLabel?: string;
    items: AppChoiceItem[];
  }>(),
  { closeLabel: "Close" },
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "select", id: string): void;
}>();
</script>

<template>
  <AppDialog
    :open="open"
    :title="title"
    :close-label="closeLabel"
    @close="emit('close')"
  >
    <div class="gg-choice-dialog__grid">
      <button
        v-for="item in items"
        :key="item.id"
        :data-choice-id="item.id"
        type="button"
        class="gg-choice-dialog__card"
        :aria-label="item.title"
        @click="emit('select', item.id)"
      >
        <span class="gg-choice-dialog__icon" aria-hidden="true">
          <slot name="icon" :item="item" />
        </span>
        <span class="gg-choice-dialog__copy">
          <strong>{{ item.title }}</strong>
          <span v-if="item.description">{{ item.description }}</span>
        </span>
      </button>
    </div>
  </AppDialog>
</template>

<style scoped>
.gg-choice-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.gg-choice-dialog__card {
  display: grid;
  min-width: 0;
  min-height: 112px;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--gg-border);
  border-radius: 8px;
  color: var(--gg-text);
  background: var(--gg-surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

.gg-choice-dialog__card:hover {
  border-color: var(--gg-primary-border);
  background: var(--gg-surface-hover);
  transform: translateY(-1px);
}

.gg-choice-dialog__card:focus-visible {
  outline: 2px solid var(--gg-ring);
  outline-offset: 2px;
}

.gg-choice-dialog__icon {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: var(--gg-primary);
}

.gg-choice-dialog__icon :deep(svg) {
  width: 22px;
  height: 22px;
}

.gg-choice-dialog__copy {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.gg-choice-dialog__copy strong {
  font-size: 14px;
  line-height: 1.35;
}

.gg-choice-dialog__copy span {
  color: var(--gg-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

@media (prefers-reduced-motion: reduce) {
  .gg-choice-dialog__card {
    transition: none;
  }
}
</style>
