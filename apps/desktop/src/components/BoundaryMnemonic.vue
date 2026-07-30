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
      <g class="boundary-mnemonic__frame">
        <line x1="4" y1="4" x2="20" y2="4" />
        <line x1="20" y1="4" x2="20" y2="20" />
        <line x1="20" y1="20" x2="4" y2="20" />
        <line x1="4" y1="20" x2="4" y2="4" />
      </g>
      <g class="boundary-mnemonic__active">
        <line v-if="activeEdge === 'top'" x1="4" y1="4" x2="20" y2="4" />
        <line v-else-if="activeEdge === 'right'" x1="20" y1="4" x2="20" y2="20" />
        <line v-else-if="activeEdge === 'bottom'" x1="20" y1="20" x2="4" y2="20" />
        <line v-else-if="activeEdge === 'left'" x1="4" y1="20" x2="4" y2="4" />
        <path v-if="activeCorner === 'leftTop'" d="M 4 11 L 4 4 L 11 4" />
        <path v-else-if="activeCorner === 'rightTop'" d="M 13 4 L 20 4 L 20 11" />
        <path v-else-if="activeCorner === 'leftBottom'" d="M 4 13 L 4 20 L 11 20" />
        <path v-else-if="activeCorner === 'rightBottom'" d="M 13 20 L 20 20 L 20 13" />
      </g>
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
.boundary-mnemonic__frame line {
  stroke: var(--el-border-color-darker);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.boundary-mnemonic__active line,
.boundary-mnemonic__active path {
  fill: none;
  stroke: var(--el-color-primary);
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
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
