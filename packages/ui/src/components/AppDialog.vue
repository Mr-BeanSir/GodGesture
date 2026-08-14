<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { X } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    closeLabel?: string;
    busy?: boolean;
    initialFocus?: string;
  }>(),
  { closeLabel: "Close", busy: false, initialFocus: "" },
);

const emit = defineEmits<{ close: []; opened: [] }>();
const dialog = ref<HTMLElement | null>(null);
const titleId = useId();
let restoreTarget: HTMLElement | null = null;

function focusableElements(): HTMLElement[] {
  if (!dialog.value) return [];
  return [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
}

async function focusDialog(): Promise<void> {
  await nextTick();
  if (!dialog.value) return;
  const preferred = props.initialFocus ? dialog.value.querySelector<HTMLElement>(props.initialFocus) : null;
  (preferred ?? focusableElements()[0] ?? dialog.value).focus();
}

function close(): void {
  if (!props.busy) emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
  if (!elements.length) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) close();
}

async function onOpen(): Promise<void> {
  restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await focusDialog();
  emit("opened");
}

async function onClose(): Promise<void> {
  await nextTick();
  restoreTarget?.focus();
  restoreTarget = null;
}

watch(() => props.open, (open) => {
  if (open) void onOpen();
  else void onClose();
});

onMounted(() => {
  if (props.open) void onOpen();
});

onBeforeUnmount(() => {
  restoreTarget?.focus();
  restoreTarget = null;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="gg-dialog-layer" @mousedown.self="onBackdropClick">
      <section
        ref="dialog"
        v-bind="$attrs"
        class="gg-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header class="gg-dialog__header">
          <h2 :id="titleId" class="gg-dialog__title">{{ title }}</h2>
          <button
            type="button"
            class="gg-icon-button"
            :aria-label="closeLabel"
            :title="closeLabel"
            :disabled="busy"
            @click="close"
          >
            <X class="gg-dialog__close-icon" aria-hidden="true" />
          </button>
        </header>
        <div class="gg-dialog__body"><slot /></div>
        <footer v-if="$slots.footer" class="gg-dialog__footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
