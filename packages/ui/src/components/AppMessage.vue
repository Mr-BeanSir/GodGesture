<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import AppMessageContent from "./AppMessageContent.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: "info" | "success" | "warning" | "error";
    duration?: number;
    closable?: boolean;
    closeLabel?: string;
    offset?: number;
  }>(),
  { variant: "info", duration: 3_000, closable: false, closeLabel: "Close", offset: 0 },
);

const emit = defineEmits<{ close: [] }>();

const visible = ref(true);
let timer: number | undefined;

function clearTimer(): void {
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timer = undefined;
}

function close(): void {
  if (!visible.value) return;
  clearTimer();
  visible.value = false;
  emit("close");
}

onMounted(() => {
  if (props.duration > 0) timer = window.setTimeout(close, props.duration);
});

onBeforeUnmount(clearTimer);
</script>

<template>
  <Teleport to="body">
    <Transition name="gg-message" appear>
      <AppMessageContent
        v-if="visible"
        v-bind="$attrs"
        :variant="variant"
        :closable="closable"
        :close-label="closeLabel"
        :offset="offset"
        @close="close"
      >
        <slot />
      </AppMessageContent>
    </Transition>
  </Teleport>
</template>
