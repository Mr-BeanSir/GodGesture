<script setup lang="ts">
/**
 * 颜色选择器封装:对外 v-model 为 #AARRGGBB(配置格式)。
 */
import { computed } from "vue";
import { argbToRgbaHex, rgbaHexToArgb } from "../utils/color";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const rgba = computed(() => argbToRgbaHex(props.modelValue));
const color = computed(() => rgba.value.slice(0, 7));
const alpha = computed(() => parseInt(rgba.value.slice(7, 9), 16));

function updateColor(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("update:modelValue", rgbaHexToArgb(`${value}${rgba.value.slice(7, 9)}`));
}

function updateAlpha(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  const normalized = Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 255;
  emit("update:modelValue", rgbaHexToArgb(`${rgba.value.slice(0, 7)}${normalized.toString(16).padStart(2, "0")}`));
}
</script>

<template>
  <div class="argb-picker">
    <input class="argb-picker__color" type="color" :value="color" @input="updateColor" />
    <input
      class="gg-number argb-picker__alpha"
      type="number"
      min="0"
      max="255"
      step="1"
      :value="alpha"
      @input="updateAlpha"
    />
    <code class="argb-picker__value">{{ props.modelValue.toUpperCase() }}</code>
  </div>
</template>

<style scoped>
.argb-picker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.argb-picker__color {
  width: 40px;
  height: 40px;
  padding: 2px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
}
.argb-picker__alpha {
  width: 76px;
}
.argb-picker__value {
  font-size: 12px;
  color: var(--gg-text-muted);
}
</style>
