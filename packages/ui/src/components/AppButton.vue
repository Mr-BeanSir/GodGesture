<script setup lang="ts">
import { computed, useAttrs, useId } from "vue";
import { LoaderCircle } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: "primary" | "secondary" | "ghost" | "danger" | "quiet";
    size?: "sm" | "md";
    loading?: boolean;
    loadingLabel?: string;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  {
    variant: "secondary",
    size: "md",
    loading: false,
    loadingLabel: "",
    disabled: false,
    type: "button",
  },
);

const attrs = useAttrs();
const loadingDescriptionId = useId();
const describedBy = computed(() => {
  const existing = attrs["aria-describedby"];
  const ids = [
    typeof existing === "string" ? existing : undefined,
    props.loading && props.loadingLabel ? loadingDescriptionId : undefined,
  ].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
});

const classes = computed(() => [
  "gg-button",
  `gg-button--${props.variant}`,
  props.size === "sm" ? "gg-button--sm" : "gg-button--md",
]);
</script>

<template>
  <button
    v-bind="attrs"
    :type="type"
    :disabled="disabled || loading"
    :class="classes"
    :aria-busy="loading || undefined"
    :aria-describedby="describedBy"
  >
    <LoaderCircle v-if="loading" class="gg-button__spinner" aria-hidden="true" />
    <slot />
    <span v-if="loading && loadingLabel" :id="loadingDescriptionId" class="gg-sr-only" role="status">
      {{ loadingLabel }}
    </span>
  </button>
</template>
