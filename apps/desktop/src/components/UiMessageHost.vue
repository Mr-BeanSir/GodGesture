<script setup lang="ts">
import { AppMessageViewport } from "@godgesture/ui";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <AppMessageViewport :close-label="t('common.close')" />
</template>
