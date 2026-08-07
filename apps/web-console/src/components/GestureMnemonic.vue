<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { GestureInput, GestureSpec } from "@godgesture/shared";
import MnemonicToken from "./MnemonicToken.vue";
import MnemonicTrigger from "./MnemonicTrigger.vue";

const props = defineProps<{ gesture: GestureSpec }>();
const { t } = useI18n();

const baseInputs = computed<GestureInput[]>(() =>
  props.gesture.inputs ?? props.gesture.strokes.map((direction) => ({
    type: "stroke",
    direction,
  })),
);

const modifierInput = computed<GestureInput | null>(() => {
  switch (props.gesture.modifier) {
    case "wheelForward":
      return { type: "wheel", direction: "forward" };
    case "wheelBackward":
      return { type: "wheel", direction: "backward" };
    case "leftButtonDown":
      return { type: "button", button: "left" };
    case "middleButtonDown":
      return { type: "button", button: "middle" };
    case "rightButtonDown":
      return { type: "button", button: "right" };
    case "x1Down":
      return { type: "button", button: "x1" };
    case "x2Down":
      return { type: "button", button: "x2" };
    default:
      return null;
  }
});

const inputs = computed(() =>
  modifierInput.value ? [...baseInputs.value, modifierInput.value] : baseInputs.value,
);

function inputLabel(input: GestureInput): string {
  if (input.type === "stroke") return t(`config.token.stroke.${input.direction}`);
  if (input.type === "wheel") return t(`config.token.wheel.${input.direction}`);
  if (input.type === "button") return t(`config.token.button.${input.button}`);
  return input.key;
}

const triggerLabel = computed(() => t(`trigger.${props.gesture.trigger}`));
const ariaLabel = computed(() =>
  [triggerLabel.value, ...inputs.value.map(inputLabel)].join(" "),
);
</script>

<template>
  <span
    class="gesture-mnemonic"
    role="img"
    :aria-label="ariaLabel"
    :title="ariaLabel"
  >
    <MnemonicTrigger :trigger="gesture.trigger" />

    <span
      v-for="(input, index) in inputs"
      :key="`${input.type}-${index}`"
      class="gesture-mnemonic__step"
      :class="{ 'gesture-mnemonic__step--modifier': index >= baseInputs.length }"
    >
      <MnemonicToken :token="input" :label="inputLabel(input)" />
    </span>
  </span>
</template>

<style scoped>
.gesture-mnemonic {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 4px;
  color: var(--el-text-color-primary);
  vertical-align: middle;
}

.gesture-mnemonic__step {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
}

.gesture-mnemonic__step--modifier {
  --wheel-modifier-accent: var(--el-color-warning);
  color: var(--el-color-warning);
}

.gesture-mnemonic__step--modifier :deep(.mnemonic-token),
.gesture-mnemonic__step--modifier :deep(.mnemonic-icon) {
  color: var(--el-color-warning);
}

</style>
