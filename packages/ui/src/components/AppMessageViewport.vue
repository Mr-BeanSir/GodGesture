<script setup lang="ts">
import AppMessageContent from "./AppMessageContent.vue";
import { dismissMessage, useMessages } from "../message";

withDefaults(
  defineProps<{
    closeLabel?: string;
  }>(),
  { closeLabel: "Close" },
);

const messages = useMessages();
</script>

<template>
  <Teleport to="body">
    <div class="gg-message-viewport" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="gg-message-list" tag="div" class="gg-message-list">
        <AppMessageContent
          v-for="entry in messages"
          :key="entry.id"
          :variant="entry.kind"
          :closable="true"
          :close-label="closeLabel"
          @close="dismissMessage(entry.id)"
        >
          {{ entry.message }}
        </AppMessageContent>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
