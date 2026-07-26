<script setup lang="ts">
/**
 * 「账户与同步」区(骨架):M6 前为演示逻辑(account store,不连后端)。
 * OAuth 凭证仅留占位;微信 / QQ 标注即将开放。
 */
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { Refresh } from "@element-plus/icons-vue";
import { useAccountStore, type OAuthProvider } from "../stores/account";

const { t } = useI18n();
const account = useAccountStore();

const email = ref("");
const password = ref("");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function onLogin() {
  if (!EMAIL_RE.test(email.value)) {
    ElMessage.warning(t("account.emailInvalid"));
    return;
  }
  if (!password.value) {
    ElMessage.warning(t("account.passwordRequired"));
    return;
  }
  await account.loginWithPassword(email.value, password.value);
  ElMessage.success(t("account.loginSuccess"));
}

async function onOAuth(provider: OAuthProvider) {
  await account.loginWithOAuth(provider);
  ElMessage.success(t("account.loginSuccess"));
}

async function onSync() {
  await account.syncNow();
  ElMessage.success(t("account.syncDone"));
}

const lastSyncText = computed(() =>
  account.lastSyncAt ? account.lastSyncAt.toLocaleString() : t("account.lastSyncNever"),
);
</script>

<template>
  <div class="account">
    <!-- 未登录 -->
    <section v-if="!account.user" class="gg-section account__login">
      <h3 class="gg-section-title">{{ t("account.loginTitle") }}</h3>
      <p class="gg-hint">{{ t("account.loginSubtitle") }}</p>

      <div class="gg-field">
        <label class="gg-field-label">{{ t("account.email") }}</label>
        <el-input v-model="email" :placeholder="t('account.emailPlaceholder')" />
      </div>
      <div class="gg-field">
        <label class="gg-field-label">{{ t("account.password") }}</label>
        <el-input
          v-model="password"
          type="password"
          show-password
          :placeholder="t('account.passwordPlaceholder')"
          @keyup.enter="onLogin"
        />
      </div>
      <div class="account__actions">
        <el-button type="primary" :loading="account.loggingIn" @click="onLogin">
          {{ t("account.login") }}
        </el-button>
        <el-button :disabled="account.loggingIn" @click="onLogin">
          {{ t("account.register") }}
        </el-button>
      </div>

      <el-divider>{{ t("account.or") }}</el-divider>
      <div class="account__oauth">
        <el-button :loading="account.loggingIn" @click="onOAuth('github')">
          {{ t("account.oauthGithub") }}
        </el-button>
        <el-button :loading="account.loggingIn" @click="onOAuth('google')">
          {{ t("account.oauthGoogle") }}
        </el-button>
        <el-tooltip :content="t('account.comingSoon')" placement="top">
          <span><el-button disabled>{{ t("account.oauthWechat") }}</el-button></span>
        </el-tooltip>
        <el-tooltip :content="t('account.comingSoon')" placement="top">
          <span><el-button disabled>{{ t("account.oauthQq") }}</el-button></span>
        </el-tooltip>
      </div>

      <el-alert type="info" :closable="false" show-icon :title="t('account.mockNotice')" />
    </section>

    <!-- 已登录 -->
    <section v-else class="gg-section account__profile">
      <h3 class="gg-section-title">{{ t("account.title") }}</h3>
      <div class="account__row">
        <span class="account__label">{{ t("account.loggedInAs") }}</span>
        <span>{{ account.user.email }}</span>
      </div>
      <div class="account__row">
        <span class="account__label">{{ t("account.device") }}</span>
        <span>{{ account.deviceName }}</span>
      </div>
      <div class="account__row">
        <span class="account__label">{{ t("account.syncStatus") }}</span>
        <el-tag :type="account.syncing ? 'warning' : 'success'" size="small">
          {{ account.syncing ? t("account.syncStatusSyncing") : t("account.syncStatusIdle") }}
        </el-tag>
      </div>
      <div class="account__row">
        <span class="account__label">{{ t("account.lastSync") }}</span>
        <span>{{ lastSyncText }}</span>
      </div>
      <div class="account__actions">
        <el-button type="primary" :icon="Refresh" :loading="account.syncing" @click="onSync">
          {{ t("account.syncNow") }}
        </el-button>
        <el-button @click="account.logout">{{ t("account.logout") }}</el-button>
      </div>
      <el-alert type="info" :closable="false" show-icon :title="t('account.mockNotice')" />
    </section>
  </div>
</template>

<style scoped>
.account {
  max-width: 460px;
}
.account__login,
.account__profile {
  gap: 14px;
}
.account__actions {
  display: flex;
  gap: 10px;
}
.account__oauth {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.account__row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.account__label {
  width: 84px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
