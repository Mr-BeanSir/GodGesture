<script setup lang="ts">
import { ToastViewport } from "@godgesture/ui";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <ToastViewport :close-label="t('common.close')" />
</template>
