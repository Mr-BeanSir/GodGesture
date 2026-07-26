<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { exchangeOAuthCode } from "../api/auth";
import { detectBrowserDeviceName } from "../utils/device";
import { errorMessageKey } from "../utils/errors";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const OAUTH_STATE_KEY = "godgesture.oauthState";
const errorKey = ref<string | null>(null);

onMounted(async () => {
  const code = route.query.code;
  const state = route.query.state;
  if (typeof code !== "string" || code.length === 0) {
    errorKey.value = "oauth.missingCode";
    return;
  }
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  if (!expected || state !== expected) {
    errorKey.value = "oauth.stateMismatch";
    return;
  }
  try {
    await exchangeOAuthCode({
      code,
      device: { name: detectBrowserDeviceName(), platform: "web" },
    });
    void router.replace("/");
  } catch (err) {
    errorKey.value = errorMessageKey(err);
  }
});
</script>

<template>
  <div class="callback-page">
    <el-result v-if="errorKey" icon="error" :title="t('oauth.failed')">
      <template #sub-title>
        <span>{{ t(errorKey) }}</span>
      </template>
      <template #extra>
        <el-button type="primary" @click="router.replace({ name: 'login' })">
          {{ t("oauth.backToLogin") }}
        </el-button>
      </template>
    </el-result>
    <div v-else v-loading="true" class="exchanging">
      {{ t("oauth.exchanging") }}
    </div>
  </div>
</template>

<style scoped>
.callback-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.exchanging {
  padding: 80px;
  color: var(--el-text-color-secondary);
}
</style>
