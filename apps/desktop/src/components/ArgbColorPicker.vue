<script setup lang="ts">
/**
 * 颜色选择器封装:对外 v-model 为 #AARRGGBB(配置格式),
 * 内部转换为 Element Plus 的 #RRGGBBAA。
 */
import { computed } from "vue";
import { argbToRgbaHex, rgbaHexToArgb } from "../utils/color";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const inner = computed<string>({
  get: () => argbToRgbaHex(props.modelValue),
  set: (v) => emit("update:modelValue", rgbaHexToArgb(v)),
});
</script>

<template>
  <div class="argb-picker">
    <el-color-picker v-model="inner" show-alpha color-format="hex" />
    <code class="argb-picker__value">{{ props.modelValue.toUpperCase() }}</code>
  </div>
</template>

<style scoped>
.argb-picker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.argb-picker__value {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
