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
const activeEdge = computed(() =>
  props.intent.origin.kind === "rubEdge" ? props.intent.origin.edge : null,
);
const activeCorner = computed(() =>
  props.intent.origin.kind === "hotCorner" ? props.intent.origin.corner : null,
);
</script>

<template>
  <span class="boundary-mnemonic">
    <svg
      class="boundary-mnemonic__screen"
      viewBox="0 0 24 24"
      role="img"
      :aria-label="origin"
    >
      <line x1="4" y1="4" x2="20" y2="4" :class="{ 'is-active': activeEdge === 'top' }" />
      <line x1="20" y1="4" x2="20" y2="20" :class="{ 'is-active': activeEdge === 'right' }" />
      <line x1="20" y1="20" x2="4" y2="20" :class="{ 'is-active': activeEdge === 'bottom' }" />
      <line x1="4" y1="20" x2="4" y2="4" :class="{ 'is-active': activeEdge === 'left' }" />
      <circle v-if="activeCorner === 'leftTop'" cx="4" cy="4" r="2.5" />
      <circle v-else-if="activeCorner === 'rightTop'" cx="20" cy="4" r="2.5" />
      <circle v-else-if="activeCorner === 'leftBottom'" cx="4" cy="20" r="2.5" />
      <circle v-else-if="activeCorner === 'rightBottom'" cx="20" cy="20" r="2.5" />
    </svg>
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
.boundary-mnemonic__screen {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  overflow: visible;
}
.boundary-mnemonic__screen line {
  stroke: var(--el-border-color-darker);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.boundary-mnemonic__screen line.is-active {
  stroke: var(--el-color-primary);
  stroke-width: 3.5;
}
.boundary-mnemonic__screen circle {
  fill: var(--el-color-primary);
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
