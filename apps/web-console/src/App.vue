<script setup lang="ts">
import { computed } from "vue";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";
import { useI18n } from "vue-i18n";

const { locale } = useI18n();
const elementLocale = computed(() => (locale.value === "zh-CN" ? zhCn : en));
</script>

<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>
