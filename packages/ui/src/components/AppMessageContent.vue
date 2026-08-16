<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-vue-next";
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: "info" | "success" | "warning" | "error";
    closable?: boolean;
    closeLabel?: string;
    offset?: number;
  }>(),
  { variant: "info", closable: false, closeLabel: "Close", offset: 0 },
);

const emit = defineEmits<{ close: [] }>();

const messageStyle = computed(() => ({ "--gg-message-offset": `${Math.max(0, props.offset)}px` }));
const icon = computed(() => {
  if (props.variant === "success") return CircleCheck;
  if (props.variant === "warning") return TriangleAlert;
  if (props.variant === "error") return CircleAlert;
  return Info;
});
const role = computed(() => (props.variant === "info" || props.variant === "success" ? "status" : "alert"));
</script>

<template>
  <span
    v-bind="$attrs"
    :class="['gg-message', `gg-message--${variant}`]"
    :style="messageStyle"
    :role="role"
    aria-live="polite"
    aria-atomic="true"
  >
    <span class="gg-message__icon-shell" aria-hidden="true">
      <component :is="icon" class="gg-message__icon" />
    </span>
    <span class="gg-message__body"><slot /></span>
    <button
      v-if="closable"
      type="button"
      class="gg-icon-button gg-message__close"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click="emit('close')"
    >
      <X class="gg-message__close-icon" aria-hidden="true" />
    </button>
  </span>
</template>
