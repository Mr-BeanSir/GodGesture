<script setup lang="ts">
import type { TriggerButton } from "@godgesture/shared";
import MnemonicIcon from "./MnemonicIcon.vue";

const props = defineProps<{ trigger: TriggerButton }>();
</script>

<template>
  <MnemonicIcon
    :symbol="`trigger-${props.trigger}`"
    view-box="0 0 20 26"
    class="mnemonic-trigger"
  />
</template>

<style scoped>
.mnemonic-trigger {
  display: block;
  width: 1.05em;
  height: 1.35em;
  flex: 0 0 auto;
  overflow: visible;
  vertical-align: middle;
}
</style>
