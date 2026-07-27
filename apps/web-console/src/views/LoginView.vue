<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { OAuthProvider } from "@godgesture/shared";
import { fetchOAuthProviders, login, registerAccount } from "../api/auth";
import { apiUrl } from "../api/client";
import { detectBrowserDeviceName } from "../utils/device";
import { errorMessageKey } from "../utils/errors";
import {
  createOAuthPkce,
  saveOAuthPkceSession,
} from "../utils/oauth-pkce";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const activeTab = ref<"login" | "register">("login");
const form = reactive({ email: "", password: "" });
const submitting = ref(false);

const enabledProviders = ref<OAuthProvider[]>([]);
const providersLoading = ref(true);
const providersUnavailable = ref(false);

async function loadOAuthProviders(): Promise<void> {
  providersLoading.value = true;
  providersUnavailable.value = false;
  try {
    enabledProviders.value = (await fetchOAuthProviders()).providers;
  } catch {
    enabledProviders.value = [];
    providersUnavailable.value = true;
  } finally {
    providersLoading.value = false;
  }
}

function redirectTarget(): string {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/")
    ? redirect
    : "/";
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    if (activeTab.value === "login") {
      await login({
        email: form.email,
        password: form.password,
        device: { name: detectBrowserDeviceName(), platform: "web" },
      });
      void router.push(redirectTarget());
    } else {
      await registerAccount({ email: form.email, password: form.password });
      ElMessage.success(t("auth.registerSuccess"));
      activeTab.value = "login";
    }
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  } finally {
    submitting.value = false;
  }
}

async function startOAuth(provider: OAuthProvider): Promise<void> {
  try {
    const { session, challenge } = await createOAuthPkce();
    saveOAuthPkceSession(sessionStorage, session);
    const redirectUri = `${window.location.origin}/oauth/callback`;
    const query = new URLSearchParams({
      redirect_uri: redirectUri,
      state: session.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    window.location.href = `${apiUrl(`/auth/oauth/${provider}/authorize`)}?${query}`;
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  }
}

onMounted(loadOAuthProviders);
</script>

<template>
  <div class="login-page">
    <el-card class="login-card">
      <h1 class="title">{{ t("app.title") }}</h1>
      <el-tabs v-model="activeTab">
        <el-tab-pane :label="t('auth.login')" name="login" />
        <el-tab-pane :label="t('auth.register')" name="register" />
      </el-tabs>
      <el-form label-position="top" @submit.prevent="onSubmit">
        <el-form-item :label="t('auth.email')">
          <el-input
            v-model="form.email"
            type="email"
            autocomplete="username"
            name="email"
          />
        </el-form-item>
        <el-form-item :label="t('auth.password')">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="activeTab === 'register' ? t('auth.passwordHint') : ''"
            :autocomplete="
              activeTab === 'login' ? 'current-password' : 'new-password'
            "
            name="password"
          />
        </el-form-item>
        <el-button
          type="primary"
          class="submit"
          native-type="submit"
          :loading="submitting"
        >
          {{
            activeTab === "login"
              ? t("auth.loginAction")
              : t("auth.registerAction")
          }}
        </el-button>
      </el-form>
      <el-divider>{{ t("auth.oauthDivider") }}</el-divider>
      <div v-loading="providersLoading" class="oauth-buttons">
        <el-button
          v-for="provider in enabledProviders"
          :key="provider"
          @click="startOAuth(provider)"
        >
          {{ t(`provider.${provider}`) }}
        </el-button>
        <template v-if="!providersLoading && providersUnavailable">
          <span class="oauth-status">{{ t("auth.oauthUnavailable") }}</span>
          <el-button text type="primary" @click="loadOAuthProviders">
            {{ t("common.retry") }}
          </el-button>
        </template>
        <span
          v-else-if="!providersLoading && enabledProviders.length === 0"
          class="oauth-status"
        >
          {{ t("auth.oauthNoneAvailable") }}
        </span>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--el-bg-color-page);
}

.login-card {
  width: 380px;
}

.title {
  margin: 0 0 12px;
  font-size: 20px;
  text-align: center;
}

.submit {
  width: 100%;
}

.oauth-buttons {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 32px;
}

.oauth-buttons .el-button + .el-button {
  margin-left: 0;
}

.oauth-status {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
