<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { OAuthProvider } from "@godgesture/shared";
import { login, registerAccount } from "../api/auth";
import { apiUrl } from "../api/client";
import { detectBrowserDeviceName } from "../utils/device";
import { errorMessageKey } from "../utils/errors";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const activeTab = ref<"login" | "register">("login");
const form = reactive({ email: "", password: "" });
const submitting = ref(false);

const OAUTH_STATE_KEY = "godgesture.oauthState";
const enabledProviders: OAuthProvider[] = ["github", "google"];
const comingSoonProviders: OAuthProvider[] = ["wechat", "qq"];

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

function startOAuth(provider: OAuthProvider): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const redirectUri = `${window.location.origin}/oauth/callback`;
  window.location.href =
    apiUrl(`/auth/oauth/${provider}/authorize`) +
    `?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;
}
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
      <div class="oauth-buttons">
        <el-button
          v-for="provider in enabledProviders"
          :key="provider"
          @click="startOAuth(provider)"
        >
          {{ t(`provider.${provider}`) }}
        </el-button>
        <el-tooltip
          v-for="provider in comingSoonProviders"
          :key="provider"
          :content="t('auth.oauthComingSoon')"
        >
          <el-button disabled>
            {{ t(`provider.${provider}`) }}
          </el-button>
        </el-tooltip>
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
}

.oauth-buttons .el-button + .el-button {
  margin-left: 0;
}
</style>
