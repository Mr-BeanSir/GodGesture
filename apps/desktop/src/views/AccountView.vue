<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useMediaQuery } from "@vueuse/core";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  InfoFilled,
  Refresh,
  RefreshLeft,
  SwitchButton,
  User,
} from "@element-plus/icons-vue";
import type { OAuthProvider } from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useAccountStore } from "../stores/account";

const { t, locale } = useI18n();
const account = useAccountStore();

const email = ref("");
const password = ref("");
const endpointChoice = ref(account.endpointMode);
const customEndpointDraft = ref(account.customApiOrigin);
const narrowLayout = useMediaQuery("(max-width: 640px)");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const endpointOptions = computed(() => [
  { label: t("account.endpointOfficial"), value: "official" },
  { label: t("account.endpointCustom"), value: "custom" },
]);

const registrationUrl = computed(() => {
  const origin = account.apiOrigin;
  return origin ? `${origin}/login?label=register` : null;
});

const syncTagType = computed(() => {
  switch (account.syncStatus.phase) {
    case "current":
      return "success";
    case "pending":
    case "syncing":
      return "warning";
    case "error":
      return "danger";
    default:
      return "info";
  }
});

const lastSyncText = computed(() => {
  if (!account.syncStatus.lastSyncAt) return t("account.lastSyncNever");
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(account.syncStatus.lastSyncAt));
});

const syncStatusText = computed(() => {
  if (account.syncStatus.phase === "current" && account.syncStatus.lastSyncAt) {
    return t("account.syncStates.currentAt", { time: lastSyncText.value });
  }
  return t(`account.syncStates.${account.syncStatus.phase}`);
});

function errorText(code: string | null): string {
  if (!code) return t("account.errors.generic");
  const key = `account.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("account.errors.generic") : translated;
}

function validateCredentials(): boolean {
  if (!EMAIL_RE.test(email.value)) {
    ElMessage.warning(t("account.emailInvalid"));
    return false;
  }
  if (!password.value) {
    ElMessage.warning(t("account.passwordRequired"));
    return false;
  }
  return true;
}

async function onSubmit(): Promise<void> {
  if (!validateCredentials()) return;
  try {
    await account.loginWithPassword(email.value, password.value);
    password.value = "";
    ElMessage.success(t("account.loginSuccess"));
  } catch {
    ElMessage.error(errorText(account.authErrorCode));
  }
}

async function onEndpointChange(value: "official" | "custom"): Promise<void> {
  if (value === "custom") return;
  try {
    await account.setEndpoint(value);
  } catch {
    endpointChoice.value = account.endpointMode;
    ElMessage.error(errorText("invalid_api_origin"));
  }
}

async function applyCustomEndpoint(): Promise<void> {
  try {
    await account.setEndpoint("custom", customEndpointDraft.value);
    endpointChoice.value = "custom";
  } catch {
    ElMessage.error(errorText("invalid_api_origin"));
  }
}

async function onRegister(): Promise<void> {
  if (!registrationUrl.value) {
    ElMessage.error(errorText("server_not_configured"));
    return;
  }
  await useBackend().openExternal(registrationUrl.value);
}

async function onOAuth(provider: OAuthProvider): Promise<void> {
  try {
    await account.loginWithOAuth(provider);
    ElMessage.success(t("account.loginSuccess"));
  } catch {
    ElMessage.error(errorText(account.authErrorCode));
  }
}

async function onSync(): Promise<void> {
  try {
    await account.syncNow();
    ElMessage.success(t("account.syncDone"));
  } catch {
    ElMessage.error(errorText(account.syncStatus.errorCode));
  }
}

async function onLogout(): Promise<void> {
  try {
    const outcome = await account.logout();
    ElMessage.success(
      t(
        outcome === "revoked"
          ? "account.logoutDone"
          : "account.logoutLocalOnly",
      ),
    );
  } catch {
    ElMessage.error(errorText(account.authErrorCode));
  }
}

async function onRestore(version: number): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("account.snapshots.restoreConfirm", { version }),
      t("account.snapshots.restoreTitle"),
      {
        type: "warning",
        confirmButtonText: t("account.snapshots.restore"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  try {
    await account.restoreSnapshot(version);
    ElMessage.success(t("account.snapshots.restoreDone"));
  } catch {
    ElMessage.error(errorText(account.syncStatus.errorCode));
  }
}

function formatSnapshotTime(value: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return t("account.snapshots.bytes", { value });
  return t("account.snapshots.kib", {
    value: new Intl.NumberFormat(locale.value, {
      maximumFractionDigits: 1,
    }).format(value / 1024),
  });
}

function providerLabel(provider: OAuthProvider): string {
  return t(`account.oauth.${provider}`);
}
</script>

<template>
  <div class="gg-page account-page">
    <header class="gg-page__header">
      <h2>{{ t("nav.account") }}</h2>
    </header>
    <div class="gg-page__scroll">
      <div class="account gg-page__stack">
    <section
      v-if="account.phase === 'initializing'"
      class="gg-section account__loading"
    >
      <h3 class="gg-section-title">{{ t("account.title") }}</h3>
      <el-skeleton :rows="5" animated />
    </section>

    <section v-else-if="account.phase === 'sessionError'" class="gg-section">
      <el-result
        icon="error"
        :title="t('account.sessionErrorTitle')"
        :sub-title="errorText(account.authErrorCode)"
      >
        <template #extra>
          <div class="account__actions account__actions--center">
            <el-button
              type="primary"
              :icon="Refresh"
              @click="account.initialize()"
            >
              {{ t("common.retry") }}
            </el-button>
            <el-button
              v-if="account.cloudConfigured"
              :icon="SwitchButton"
              @click="account.discardStoredSession()"
            >
              {{ t("account.clearSession") }}
            </el-button>
          </div>
        </template>
      </el-result>
    </section>

    <section
      v-else-if="account.phase === 'signedOut'"
      class="gg-section account__login"
    >
      <div class="account__login-head">
        <span class="account__identity-icon" aria-hidden="true">
          <el-icon><User /></el-icon>
        </span>
        <div>
          <h3 class="gg-section-title">{{ t("account.loginTitle") }}</h3>
          <p class="gg-hint account__subtitle">
            {{ t("account.loginSubtitle") }}
          </p>
        </div>
        <div class="account__endpoint">
          <label class="account__endpoint-label" for="account-endpoint">
            {{ t("account.endpointLabel") }}
          </label>
          <el-select
            id="account-endpoint"
            v-model="endpointChoice"
            size="small"
            @change="onEndpointChange"
          >
            <el-option
              v-for="option in endpointOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-input
            v-if="endpointChoice === 'custom'"
            v-model="customEndpointDraft"
            size="small"
            class="account__endpoint-input"
            :placeholder="t('account.endpointPlaceholder')"
            @keyup.enter="applyCustomEndpoint"
            @blur="applyCustomEndpoint"
          />
        </div>
      </div>

      <el-alert
        v-if="account.authErrorCode"
        class="account__auth-error"
        type="error"
        :closable="false"
        show-icon
        :title="errorText(account.authErrorCode)"
      />

      <div class="account__login-grid">
        <div class="account__credentials">
          <div class="account__form">
            <div class="gg-field">
              <label class="gg-field-label" for="account-email">{{
                t("account.email")
              }}</label>
              <el-input
                id="account-email"
                v-model="email"
                autocomplete="email"
                :placeholder="t('account.emailPlaceholder')"
              />
            </div>
            <div class="gg-field">
              <label class="gg-field-label" for="account-password">{{
                t("account.password")
              }}</label>
              <el-input
                id="account-password"
                v-model="password"
                type="password"
                show-password
                autocomplete="current-password"
                :placeholder="t('account.passwordPlaceholder')"
                @keyup.enter="onSubmit"
              />
            </div>
            <el-button
              class="account__submit"
              type="primary"
              :loading="account.authBusy"
              @click="onSubmit"
            >
              {{ t("account.login") }}
            </el-button>
            <el-button
              class="account__register-link"
              link
              type="primary"
              :disabled="!registrationUrl"
              @click="onRegister"
            >
              {{ t("account.register") }}
            </el-button>
          </div>
        </div>

        <div
          v-if="
            account.providersLoading ||
            account.providers.length ||
            account.providersError
          "
          class="account__oauth-panel"
        >
          <p class="account__oauth-title">{{ t("account.or") }}</p>
          <el-skeleton v-if="account.providersLoading" :rows="2" animated />
          <div v-else-if="account.providers.length" class="account__oauth">
            <el-button
              v-for="provider in account.providers"
              :key="provider"
              :loading="account.authBusy"
              @click="onOAuth(provider)"
            >
              {{ providerLabel(provider) }}
            </el-button>
          </div>
          <div v-else class="account__provider-status" role="status">
            <el-icon aria-hidden="true"><InfoFilled /></el-icon>
            <span>{{ t("account.providersUnavailable") }}</span>
            <el-button link type="primary" @click="account.loadProviders()">
              {{ t("common.retry") }}
            </el-button>
          </div>
        </div>
      </div>
    </section>

    <template v-else>
      <section class="gg-section account__profile">
        <div class="account__section-head">
          <h3 class="gg-section-title">{{ t("account.title") }}</h3>
          <el-tag :type="syncTagType" size="small">{{ syncStatusText }}</el-tag>
        </div>

        <dl class="account__properties">
          <div class="account__row">
            <dt>{{ t("account.loggedInAs") }}</dt>
            <dd>{{ account.user?.email || t("account.providerAccount") }}</dd>
          </div>
          <div class="account__row">
            <dt>{{ t("account.device") }}</dt>
            <dd>{{ account.device?.name }}</dd>
          </div>
          <div class="account__row">
            <dt>{{ t("account.lastSync") }}</dt>
            <dd>{{ lastSyncText }}</dd>
          </div>
          <div class="account__row">
            <dt>{{ t("account.serverVersion") }}</dt>
            <dd>
              {{
                account.syncStatus.serverVersion ?? t("account.notAvailable")
              }}
            </dd>
          </div>
        </dl>

        <el-alert
          v-if="account.syncStatus.errorCode"
          :type="account.syncStatus.phase === 'offline' ? 'info' : 'error'"
          :closable="false"
          show-icon
          :title="errorText(account.syncStatus.errorCode)"
        />

        <div class="account__actions">
          <el-button
            type="primary"
            :icon="Refresh"
            :loading="account.syncStatus.phase === 'syncing'"
            @click="onSync"
          >
            {{ t("account.syncNow") }}
          </el-button>
          <el-button
            :icon="SwitchButton"
            :loading="account.authBusy"
            @click="onLogout"
          >
            {{ t("account.logout") }}
          </el-button>
        </div>
      </section>

      <section class="gg-section account__snapshots">
        <div class="account__section-head">
          <div>
            <h3 class="gg-section-title">{{ t("account.snapshots.title") }}</h3>
            <p class="gg-hint account__subtitle">
              {{ t("account.snapshots.subtitle") }}
            </p>
          </div>
          <el-tooltip :content="t('account.snapshots.refresh')" placement="top">
            <el-button
              circle
              :icon="Refresh"
              :loading="account.snapshotsLoading"
              @click="account.loadSnapshots()"
            />
          </el-tooltip>
        </div>

        <el-alert
          v-if="account.snapshotsErrorCode"
          type="error"
          :closable="false"
          show-icon
          :title="errorText(account.snapshotsErrorCode)"
        />

        <el-table
          :data="account.snapshots"
          :empty-text="t('account.snapshots.empty')"
          size="small"
          v-loading="account.snapshotsLoading"
        >
          <el-table-column
            prop="version"
            :label="t('account.snapshots.version')"
            :width="narrowLayout ? 64 : 86"
          />
          <el-table-column
            :label="t('account.snapshots.time')"
            :min-width="narrowLayout ? 180 : 170"
          >
            <template #default="scope">
              <div>{{ formatSnapshotTime(scope.row.createdAt) }}</div>
              <div v-if="narrowLayout" class="account__snapshot-meta">
                {{
                  scope.row.deviceName || t("account.snapshots.unknownDevice")
                }}
                /
                {{ formatBytes(scope.row.sizeBytes) }}
              </div>
              <div v-if="narrowLayout && scope.row.note" class="account__snapshot-note">
                {{ scope.row.note }}
              </div>
            </template>
          </el-table-column>
          <el-table-column
            v-if="!narrowLayout"
            :label="t('account.snapshots.device')"
            min-width="145"
          >
            <template #default="scope">
              {{ scope.row.deviceName || t("account.snapshots.unknownDevice") }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="!narrowLayout"
            :label="t('account.snapshots.size')"
            width="90"
          >
            <template #default="scope">{{
              formatBytes(scope.row.sizeBytes)
            }}</template>
          </el-table-column>
          <el-table-column
            v-if="!narrowLayout"
            :label="t('account.snapshots.note')"
            min-width="220"
            show-overflow-tooltip
          >
            <template #default="scope">
              {{ scope.row.note || t("account.snapshots.noteEmpty") }}
            </template>
          </el-table-column>
          <el-table-column
            :label="t('account.snapshots.actions')"
            :width="narrowLayout ? 64 : 76"
            align="right"
          >
            <template #default="scope">
              <el-tooltip
                :content="t('account.snapshots.restore')"
                placement="left"
              >
                <el-button
                  circle
                  text
                  :icon="RefreshLeft"
                  :disabled="account.syncStatus.phase === 'syncing'"
                  @click="onRestore(scope.row.version)"
                />
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account {
  width: min(100%, 840px);
}
.account__loading {
  min-height: 280px;
}
.account__login {
  width: 100%;
}
.account__login-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.account__login-head > div:nth-child(2) {
  min-width: 0;
}
.account__endpoint {
  margin-left: auto;
  min-width: 180px;
  display: grid;
  gap: 4px;
}
.account__endpoint-label {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
.account__endpoint-input {
  width: 240px;
}
.account__identity-icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  font-size: 17px;
}
.account__subtitle {
  margin-top: 5px;
}
.account__auth-error {
  margin-top: -2px;
}
.account__login-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 26px;
}
.account__credentials {
  min-width: 0;
}
.account__form {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}
.account__submit {
  width: 100%;
}
.account__register-link {
  width: 100%;
  margin: 0;
}
.account__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.account__oauth-panel {
  min-width: 0;
  padding-left: 26px;
  border-left: 1px solid var(--el-border-color-lighter);
}
.account__oauth-title {
  margin: 2px 0 14px;
  color: var(--el-text-color-regular);
  font-size: 13px;
  font-weight: 500;
}
.account__oauth {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}
.account__oauth .el-button {
  width: 100%;
  margin: 0;
}
.account__provider-status {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.45;
}
.account__provider-status .el-icon {
  flex: 0 0 auto;
  color: var(--el-color-info);
}
.account__provider-status span {
  min-width: 0;
  flex: 1 1 160px;
}
.account__provider-status .el-button {
  margin-left: auto;
}
.account__actions--center {
  justify-content: center;
}
.account__section-head {
  min-height: 32px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.account__properties {
  margin: 0;
}
.account__row {
  display: grid;
  grid-template-columns: minmax(110px, 0.35fr) minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  min-height: 34px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}
.account__row:last-child {
  border-bottom: 0;
}
.account__row dt {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.account__row dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}
.account__snapshots :deep(.el-table) {
  width: 100%;
}
.account__snapshot-meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.account__snapshot-note {
  overflow: hidden;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .account__login-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .account__endpoint {
    width: 100%;
    margin-left: 42px;
  }
  .account__endpoint-input {
    width: 100%;
  }
  .account__login-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .account__oauth-panel {
    padding-top: 18px;
    padding-left: 0;
    border-top: 1px solid var(--el-border-color-lighter);
    border-left: 0;
  }
  .account__oauth-title {
    margin-top: 0;
  }
  .account__row {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 7px 0;
  }
}
</style>
