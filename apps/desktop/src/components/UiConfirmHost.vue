<script setup lang="ts">
import { AppButton, AppDialog, useConfirmDialog, usePendingConfirm } from "@godgesture/ui";

const pending = usePendingConfirm();
const { resolveConfirm, submitConfirm } = useConfirmDialog();
</script>

<template>
  <AppDialog
    :open="Boolean(pending)"
    :title="pending?.title ?? ''"
    :close-label="pending?.cancelLabel ?? ''"
    :busy="pending?.busy ?? false"
    initial-focus="[data-confirm-action]"
    @close="resolveConfirm(false)"
  >
    <p class="ui-confirm__message">{{ pending?.message }}</p>
    <template #footer>
      <AppButton variant="secondary" :disabled="pending?.busy" @click="resolveConfirm(false)">
        {{ pending?.cancelLabel }}
      </AppButton>
      <AppButton
        data-confirm-action
        :variant="pending?.variant ?? 'primary'"
        :loading="pending?.busy"
        @click="submitConfirm()"
      >
        {{ pending?.confirmLabel }}
      </AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.ui-confirm__message {
  margin: 0;
  color: var(--gg-text-muted);
  line-height: 1.55;
}
</style>
