<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BoundaryIntent, BoundaryToken } from "@godgesture/shared";

const props = defineProps<{ intent: BoundaryIntent }>();
const { t } = useI18n();

function tokenLabel(token: BoundaryToken): string {
  if (token.type === "wheel") return t(`actions.token.wheel.${token.direction}`);
  if (token.type === "button") return t(`actions.token.button.${token.button}`);
  return t(`actions.token.stroke.${token.direction}`);
}

const origin = computed(() =>
  props.intent.origin.kind === "hotCorner"
    ? t(`corners.corner.${props.intent.origin.corner}`)
    : t(`corners.edge.${props.intent.origin.edge}`),
);
</script>

<template>
  <span class="boundary-mnemonic">
    <span class="boundary-mnemonic__origin">{{ origin }}</span>
    <template v-if="intent.sequence.length">
      <span class="boundary-mnemonic__arrow">›</span>
      <span v-for="(token, index) in intent.sequence" :key="index" class="boundary-mnemonic__token">
        {{ tokenLabel(token) }}
      </span>
    </template>
    <span v-else class="boundary-mnemonic__token">{{ t("actions.immediate") }}</span>
  </span>
</template>

<style scoped>
.boundary-mnemonic {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
.boundary-mnemonic__origin {
  font-weight: 600;
}
.boundary-mnemonic__arrow {
  color: var(--el-text-color-placeholder);
}
.boundary-mnemonic__token {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
}
</style>
