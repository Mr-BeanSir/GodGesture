<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  OAuthCallbackErrorCode,
  type OAuthCallbackErrorCode as OAuthCallbackErrorCodeValue,
} from "@godgesture/shared";
import { exchangeOAuthCode } from "../api/auth";
import { detectBrowserDeviceName } from "../utils/device";
import { errorMessageKey } from "../utils/errors";
import { consumeOAuthPkceSession } from "../utils/oauth-pkce";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const errorKey = ref<string | null>(null);

const callbackErrorKeys: Record<OAuthCallbackErrorCodeValue, string> = {
  oauth_access_denied: "oauth.accessDenied",
  oauth_provider_unavailable: "oauth.providerUnavailable",
  oauth_email_conflict: "error.oauth_email_conflict",
  oauth_callback_failed: "oauth.callbackFailed",
};

onMounted(async () => {
  const code = route.query.code;
  const state = route.query.state;
  const callbackError = route.query.error;
  const pkce = consumeOAuthPkceSession(sessionStorage);
  if (!pkce || state !== pkce.state) {
    errorKey.value = "oauth.stateMismatch";
    return;
  }
  if (typeof callbackError === "string") {
    const parsed = OAuthCallbackErrorCode.safeParse(callbackError);
    errorKey.value = parsed.success
      ? callbackErrorKeys[parsed.data]
      : "oauth.callbackFailed";
    return;
  }
  if (typeof code !== "string" || code.length === 0) {
    errorKey.value = "oauth.missingCode";
    return;
  }
  try {
    await exchangeOAuthCode({
      code,
      codeVerifier: pkce.verifier,
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
