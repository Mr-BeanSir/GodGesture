<script setup lang="ts">
import { ChevronDown } from "lucide-vue-next";
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open?: boolean;
    panelId: string;
    label: string;
  }>(),
  { open: true },
);

const emit = defineEmits<{
  "update:open": [open: boolean];
}>();

const triggerId = computed(() => `${props.panelId}-trigger`);
const contentId = computed(() => `${props.panelId}-content`);

function toggle(): void {
  emit("update:open", !props.open);
}
</script>

<template>
  <section v-bind="$attrs" class="gg-panel gg-collapsible-panel">
    <div class="gg-collapsible-panel__header">
      <h3 class="gg-collapsible-panel__heading">
        <button
          :id="triggerId"
          type="button"
          class="gg-collapsible-panel__trigger"
          :aria-label="label"
          :aria-expanded="open"
          :aria-controls="contentId"
          data-collapsible-panel-trigger
          @click="toggle"
        >
          <span v-if="$slots.icon" class="gg-collapsible-panel__icon"
            ><slot name="icon"
          /></span>
          <span class="gg-collapsible-panel__copy">
            <span class="gg-collapsible-panel__title"
              ><slot name="title"
            /></span>
            <span
              v-if="$slots.description"
              class="gg-collapsible-panel__description"
              ><slot name="description"
            /></span>
          </span>
          <ChevronDown
            class="gg-collapsible-panel__chevron"
            :class="{ 'gg-collapsible-panel__chevron--open': open }"
            aria-hidden="true"
          />
        </button>
      </h3>
      <div v-if="$slots.aside" class="gg-collapsible-panel__aside">
        <slot name="aside" />
      </div>
    </div>

    <Transition name="gg-panel-collapse">
      <div
        v-show="open"
        :id="contentId"
        class="gg-collapsible-panel__content"
        role="region"
        :aria-labelledby="triggerId"
        data-collapsible-panel-content
      >
        <div class="gg-collapsible-panel__body"><slot /></div>
      </div>
    </Transition>
  </section>
</template>
