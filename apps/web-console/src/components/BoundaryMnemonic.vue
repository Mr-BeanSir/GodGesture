<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BoundaryIntent, BoundaryToken } from "@godgesture/shared";
import MnemonicIcon from "./MnemonicIcon.vue";
import MnemonicToken from "./MnemonicToken.vue";

const props = defineProps<{ intent: BoundaryIntent }>();
const { t } = useI18n();

const origin = computed(() =>
  props.intent.origin.kind === "hotCorner"
    ? t(`config.corner.${props.intent.origin.corner}`)
    : t(`config.edge.${props.intent.origin.edge}`),
);

const boundarySymbol = computed(() =>
  props.intent.origin.kind === "hotCorner"
    ? `boundary-corner-${props.intent.origin.corner}`
    : `boundary-edge-${props.intent.origin.edge}`,
);

function tokenLabel(token: BoundaryToken): string {
  if (token.type === "wheel") return t(`config.token.wheel.${token.direction}`);
  if (token.type === "button") return t(`config.token.button.${token.button}`);
  return t(`config.token.stroke.${token.direction}`);
}

const ariaLabel = computed(() => {
  const steps = props.intent.sequence.map(tokenLabel);
  return [origin.value, steps.length ? "" : t("config.immediate"), ...steps]
    .filter(Boolean)
    .join(" ");
});
</script>

<template>
  <span
    class="boundary-mnemonic"
    role="img"
    :aria-label="ariaLabel"
    :title="ariaLabel"
  >
    <span class="boundary-mnemonic__screen" aria-hidden="true">
      <MnemonicIcon
        symbol="boundary-frame"
        view-box="0 0 24 24"
        class="boundary-mnemonic__screen-frame"
      />
      <MnemonicIcon
        :symbol="boundarySymbol"
        view-box="0 0 24 24"
        class="boundary-mnemonic__screen-active"
      />
    </span>

    <template v-if="intent.sequence.length">
      <MnemonicToken
        v-for="(token, index) in intent.sequence"
        :key="`${token.type}-${index}`"
        :token="token"
        :label="tokenLabel(token)"
      >
      </MnemonicToken>
    </template>
    <MnemonicIcon
      v-else
      symbol="immediate"
      view-box="0 0 24 24"
      class="boundary-mnemonic__immediate"
    />
  </span>
</template>

<style scoped>
.boundary-mnemonic {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 4px;
  color: var(--el-text-color-primary);
  vertical-align: middle;
}

.boundary-mnemonic__screen {
  position: relative;
  display: block;
  width: 1.35em;
  height: 1.35em;
  flex: 0 0 auto;
  overflow: visible;
}

.boundary-mnemonic__screen :deep(.boundary-mnemonic__screen-frame),
.boundary-mnemonic__screen :deep(.boundary-mnemonic__screen-active) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.boundary-mnemonic__screen :deep(.boundary-mnemonic__screen-frame) {
  color: var(--el-border-color-darker);
}

.boundary-mnemonic__screen :deep(.boundary-mnemonic__screen-active) {
  color: var(--el-color-primary);
}

.boundary-mnemonic__immediate {
  display: block;
  width: 1.35em;
  height: 1.35em;
  flex: 0 0 auto;
  fill: var(--el-color-warning);
  overflow: visible;
}
</style>
