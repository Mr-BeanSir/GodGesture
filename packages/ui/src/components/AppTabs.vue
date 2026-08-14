<script setup lang="ts">
import { computed, nextTick, useId } from "vue";

export interface AppTabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    tabs: AppTabItem[];
    modelValue?: string;
    ariaLabel?: string;
  }>(),
  { modelValue: "", ariaLabel: "" },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
const activeId = computed(() =>
  props.tabs.some((tab) => tab.id === props.modelValue && !tab.disabled)
    ? props.modelValue
    : props.tabs.find((tab) => !tab.disabled)?.id ?? "",
);
const activeTab = computed(() => props.tabs.find((tab) => tab.id === activeId.value));
const tabId = (id: string) => `app-tabs-${uid}-${id}`;
const panelId = (id: string) => `app-tabs-panel-${uid}-${id}`;

function select(id: string): void {
  const tab = props.tabs.find((candidate) => candidate.id === id);
  if (!tab || tab.disabled || tab.id === activeId.value) return;
  emit("update:modelValue", tab.id);
}

function focusTab(id: string): void {
  void nextTick(() => {
    document.getElementById(tabId(id))?.focus();
  });
}

function move(event: KeyboardEvent, direction: 1 | -1 | "first" | "last"): void {
  const enabled = props.tabs.filter((tab) => !tab.disabled);
  if (!enabled.length) return;
  const currentIndex = Math.max(0, enabled.findIndex((tab) => tab.id === activeId.value));
  const index = direction === "first"
    ? 0
    : direction === "last"
      ? enabled.length - 1
      : (currentIndex + direction + enabled.length) % enabled.length;
  event.preventDefault();
  const next = enabled[index];
  select(next.id);
  focusTab(next.id);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") move(event, 1);
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(event, -1);
  else if (event.key === "Home") move(event, "first");
  else if (event.key === "End") move(event, "last");
}
</script>

<template>
  <div class="gg-tabs">
    <div class="gg-tabs__list" role="tablist" :aria-label="ariaLabel || undefined">
      <button
        v-for="tab in tabs"
        :id="tabId(tab.id)"
        :key="tab.id"
        class="gg-tabs__tab"
        :class="{ 'gg-tabs__tab--active': activeId === tab.id }"
        role="tab"
        type="button"
        :data-tab-id="tab.id"
        :aria-selected="activeId === tab.id"
        :aria-controls="panelId(tab.id)"
        :aria-disabled="tab.disabled || undefined"
        :disabled="tab.disabled"
        :tabindex="activeId === tab.id ? 0 : -1"
        @click="select(tab.id)"
        @keydown="onKeydown"
      >
        <span>{{ tab.label }}</span>
        <span v-if="tab.count !== undefined" class="gg-tabs__count" aria-hidden="true">{{ tab.count }}</span>
      </button>
    </div>
    <div
      v-if="activeTab"
      :id="panelId(activeTab.id)"
      class="gg-tabs__panel"
      role="tabpanel"
      tabindex="0"
      :aria-labelledby="tabId(activeTab.id)"
    >
      <slot :name="activeTab.id" :tab="activeTab" />
      <slot v-if="!$slots[activeTab.id]" :tab="activeTab" />
    </div>
  </div>
</template>
