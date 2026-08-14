<script setup lang="ts">
import { computed } from "vue";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: "info" | "success" | "warning" | "error";
    title?: string;
    dismissible?: boolean;
    closeLabel?: string;
  }>(),
  { variant: "info", title: "", dismissible: false, closeLabel: "Close" },
);

defineEmits<{ close: [] }>();

const icon = computed(() => {
  if (props.variant === "success") return CircleCheck;
  if (props.variant === "warning") return TriangleAlert;
  if (props.variant === "error") return CircleAlert;
  return Info;
});
const role = computed(() => (props.variant === "info" || props.variant === "success" ? "status" : "alert"));
</script>

<template>
  <div v-bind="$attrs" :class="['gg-alert', `gg-alert--${variant}`]" :role="role">
    <component :is="icon" class="gg-alert__icon" aria-hidden="true" />
    <div class="gg-alert__body">
      <div v-if="title" class="gg-alert__title">{{ title }}</div>
      <div v-if="$slots.default"><slot /></div>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="gg-icon-button"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click="$emit('close')"
    >
      <X class="gg-alert__close-icon" aria-hidden="true" />
    </button>
  </div>
</template>
