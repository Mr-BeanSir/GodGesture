<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { OAuthProvider } from "@godgesture/shared";
import {
  confirmPasswordReset,
  fetchOAuthProviders,
  login,
  registerAccount,
  requestPasswordResetCode,
  requestRegistrationCode,
} from "../api/auth";
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

type LoginMode = "login" | "register" | "forgot";
const activeMode = ref<LoginMode>(
  route.query.label === "register" ? "register" : "login",
);
const form = reactive({
  email: "",
  password: "",
  verificationCode: "",
});
const submitting = ref(false);
const codeSending = ref(false);
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | undefined;

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

function startCooldown(seconds: number): void {
  cooldown.value = Math.max(1, seconds);
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = undefined;
    }
  }, 1000);
}

function stopCooldown(): void {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = undefined;
  }
}

async function sendVerificationCode(): Promise<void> {
  if (codeSending.value || cooldown.value > 0 || !form.email) return;
  codeSending.value = true;
  try {
    const result =
      activeMode.value === "register"
        ? await requestRegistrationCode(form.email)
        : await requestPasswordResetCode({ email: form.email });
    startCooldown(result.retryAfterSec);
    ElMessage.success(t("auth.codeSent"));
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  } finally {
    codeSending.value = false;
  }
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    if (activeMode.value === "login") {
      await login({
        email: form.email,
        password: form.password,
        device: { name: detectBrowserDeviceName(), platform: "web" },
      });
      void router.push(redirectTarget());
    } else if (activeMode.value === "register") {
      await registerAccount({
        email: form.email,
        password: form.password,
        verificationCode: form.verificationCode,
      });
      ElMessage.success(t("auth.registerSuccess"));
      activeMode.value = "login";
      form.verificationCode = "";
    } else {
      await confirmPasswordReset({
        email: form.email,
        password: form.password,
        verificationCode: form.verificationCode,
      });
      ElMessage.success(t("auth.passwordResetSuccess"));
      activeMode.value = "login";
      form.password = "";
      form.verificationCode = "";
    }
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  } finally {
    submitting.value = false;
  }
}

function changeMode(mode: LoginMode): void {
  activeMode.value = mode;
  form.password = "";
  form.verificationCode = "";
  cooldown.value = 0;
}

async function startOAuth(provider: OAuthProvider): Promise<void> {
  try {
    const { session, challenge } = await createOAuthPkce();
    saveOAuthPkceSession(sessionStorage, session);
    const redirectUri = window.location.origin + "/oauth/callback";
    const query = new URLSearchParams({
      redirect_uri: redirectUri,
      state: session.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    window.location.href =
      apiUrl("/auth/oauth/" + provider + "/authorize") + "?" + query;
  } catch (err) {
    ElMessage.error(t(errorMessageKey(err)));
  }
}

onMounted(loadOAuthProviders);
onBeforeUnmount(stopCooldown);
</script>

<template>
  <div class="login-page">
    <el-card class="login-card">
      <div class="login-heading">
        <span class="login-kicker">{{ t("app.title") }}</span>
        <h1 class="title">
          {{
            activeMode === "forgot"
              ? t("auth.passwordReset")
              : activeMode === "register"
                ? t("auth.register")
                : t("auth.login")
          }}
        </h1>
      </div>
      <el-tabs
        v-if="activeMode !== 'forgot'"
        :model-value="activeMode"
        @update:model-value="changeMode($event as LoginMode)"
      >
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
        <el-form-item
          v-if="activeMode !== 'login'"
          :label="t('auth.verificationCode')"
        >
          <div class="code-row">
            <el-input
              v-model="form.verificationCode"
              inputmode="numeric"
              maxlength="6"
              autocomplete="one-time-code"
              name="verificationCode"
            />
            <el-button
              :loading="codeSending"
              :disabled="!form.email || cooldown > 0"
              @click="sendVerificationCode"
            >
              {{
                cooldown > 0
                  ? t("auth.codeCountdown", { seconds: cooldown })
                  : t("auth.sendCode")
              }}
            </el-button>
          </div>
        </el-form-item>
        <el-form-item :label="t('auth.password')">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="
              activeMode === 'login' ? '' : t('auth.passwordHint')
            "
            :autocomplete="
              activeMode === 'login' ? 'current-password' : 'new-password'
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
            activeMode === "login"
              ? t("auth.loginAction")
              : activeMode === "register"
                ? t("auth.registerAction")
                : t("auth.passwordResetAction")
          }}
        </el-button>
      </el-form>
      <div class="secondary-actions">
        <el-button
          v-if="activeMode === 'login'"
          link
          type="primary"
          @click="changeMode('forgot')"
        >
          {{ t("auth.forgotPassword") }}
        </el-button>
        <el-button
          v-else-if="activeMode === 'forgot'"
          link
          type="primary"
          @click="changeMode('login')"
        >
          {{ t("auth.backToLogin") }}
        </el-button>
      </div>
      <template v-if="activeMode === 'login'">
        <el-divider>{{ t("auth.oauthDivider") }}</el-divider>
        <div v-loading="providersLoading" class="oauth-buttons">
          <el-button
            v-for="provider in enabledProviders"
            :key="provider"
            @click="startOAuth(provider)"
          >
            {{ t("provider." + provider) }}
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
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: var(--el-bg-color-page);
}

.login-card {
  width: min(420px, 100%);
}

.login-heading {
  margin-bottom: 10px;
}

.login-kicker {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.title {
  margin: 4px 0 0;
  font-size: 22px;
}

.submit {
  width: 100%;
}

.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  width: 100%;
  gap: 8px;
}

.secondary-actions {
  display: flex;
  justify-content: center;
  min-height: 32px;
  padding-top: 4px;
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

@media (max-width: 420px) {
  .code-row {
    grid-template-columns: 1fr;
  }
}
</style>
