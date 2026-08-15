<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-vue-next";
import { computed } from "vue";
import { dismissToast, useToasts } from "../toast";

const props = withDefaults(
  defineProps<{
    closeLabel?: string;
    placement?: "top-right" | "bottom-right";
  }>(),
  { closeLabel: "Close", placement: "bottom-right" },
);

const toasts = useToasts();
const iconFor = computed(() => (kind: string) => {
  if (kind === "success") return CircleCheck;
  if (kind === "warning") return TriangleAlert;
  if (kind === "error") return CircleAlert;
  return Info;
});
</script>

<template>
  <div :class="['gg-toast-viewport', `gg-toast-viewport--${props.placement}`]" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="gg-toast-list">
      <div v-for="toast in toasts" :key="toast.id" :class="['gg-toast', `gg-toast--${toast.kind}`]" role="status">
        <span class="gg-toast__icon-shell" aria-hidden="true">
          <component :is="iconFor(toast.kind)" class="gg-toast__icon" />
        </span>
        <span class="gg-toast__message">{{ toast.message }}</span>
        <button
          type="button"
          class="gg-icon-button gg-toast__close"
          :aria-label="props.closeLabel"
          :title="props.closeLabel"
          @click="dismissToast(toast.id)"
        >
          <X class="gg-toast__close-icon" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
