<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useMediaQuery } from "@vueuse/core";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  LogOut,
  RefreshCw,
  RotateCcw,
  UserRound,
} from "lucide-vue-next";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppEmptyState,
  AppSkeleton,
  AppSpinner,
  pushToast,
  useConfirmDialog,
} from "@godgesture/ui";
import type { OAuthProvider } from "@godgesture/shared";
import { useBackend } from "../api/backend";
import { useAccountStore } from "../stores/account";

const { t, locale } = useI18n();
const account = useAccountStore();
const { confirm } = useConfirmDialog();

const email = ref("");
const password = ref("");
const passwordVisible = ref(false);
const pendingEmail = ref("");
const pendingCode = ref("");
const endpointChoice = ref<"official" | "custom">(account.endpointMode);
const customEndpointDraft = ref(account.customApiOrigin);
const displayNameDraft = ref("");
const sessionRetryBusy = ref(false);
const sessionClearBusy = ref(false);
const endpointBusy = ref(false);
const registrationBusy = ref(false);
const pendingCodeBusy = ref(false);
const pendingCompletionBusy = ref(false);
const displayNameBusy = ref(false);
const syncBusy = ref(false);
const narrowLayout = useMediaQuery("(max-width: 640px)");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pageSizeOptions = [10, 20, 50];

const endpointOptions = computed(() => [
  { label: t("account.endpointOfficial"), value: "official" },
  { label: t("account.endpointCustom"), value: "custom" },
]);

const registrationUrl = computed(() => {
  const origin = account.apiOrigin;
  return origin ? `${origin}/login?label=register` : null;
});

const syncBadgeVariant = computed(() => {
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

const syncButtonBusy = computed(() => syncBusy.value || account.syncStatus.phase === "syncing");
const snapshotPageItems = computed<(number | null)[]>(() => {
  const total = Math.max(1, account.snapshotsTotalPages);
  const current = Math.min(Math.max(account.snapshotsPage, 1), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const result: (number | null)[] = [];

  for (const page of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && page - previous > 1) result.push(null);
    result.push(page);
  }
  return result;
});

function errorText(code: string | null): string {
  if (!code) return t("account.errors.generic");
  const key = `account.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("account.errors.generic") : translated;
}

function validateCredentials(): boolean {
  if (!EMAIL_RE.test(email.value)) {
    pushToast({ kind: "warning", message: t("account.emailInvalid") });
    return false;
  }
  if (!password.value) {
    pushToast({ kind: "warning", message: t("account.passwordRequired") });
    return false;
  }
  return true;
}

async function onSubmit(): Promise<void> {
  if (!validateCredentials() || account.authBusy) return;
  try {
    await account.loginWithPassword(email.value, password.value);
    password.value = "";
    pushToast({ kind: "success", message: t("account.loginSuccess") });
  } catch {
    pushToast({ kind: "error", message: errorText(account.authErrorCode) });
  }
}

async function onInitialize(): Promise<void> {
  if (sessionRetryBusy.value) return;
  sessionRetryBusy.value = true;
  try {
    await account.initialize();
  } finally {
    sessionRetryBusy.value = false;
  }
}

async function onDiscardStoredSession(): Promise<void> {
  if (sessionClearBusy.value) return;
  sessionClearBusy.value = true;
  try {
    await account.discardStoredSession();
  } finally {
    sessionClearBusy.value = false;
  }
}

async function onEndpointChange(value: "official" | "custom"): Promise<void> {
  if (value === "custom" || endpointBusy.value) return;
  endpointBusy.value = true;
  try {
    await account.setEndpoint(value);
  } catch {
    endpointChoice.value = account.endpointMode;
    pushToast({ kind: "error", message: errorText("invalid_api_origin") });
  } finally {
    endpointBusy.value = false;
  }
}

async function applyCustomEndpoint(): Promise<void> {
  if (endpointBusy.value || endpointChoice.value !== "custom") return;
  endpointBusy.value = true;
  try {
    await account.setEndpoint("custom", customEndpointDraft.value);
    endpointChoice.value = "custom";
  } catch {
    pushToast({ kind: "error", message: errorText("invalid_api_origin") });
  } finally {
    endpointBusy.value = false;
  }
}

async function onRegister(): Promise<void> {
  if (!registrationUrl.value || registrationBusy.value) {
    if (!registrationUrl.value) {
      pushToast({ kind: "error", message: errorText("server_not_configured") });
    }
    return;
  }

  registrationBusy.value = true;
  try {
    await useBackend().openExternal(registrationUrl.value);
  } finally {
    registrationBusy.value = false;
  }
}

async function onOAuth(provider: OAuthProvider): Promise<void> {
  if (account.authBusy) return;
  try {
    await account.loginWithOAuth(provider);
    pushToast({ kind: "success", message: t("account.loginSuccess") });
  } catch {
    pushToast({ kind: "error", message: errorText(account.authErrorCode) });
  }
}

async function sendPendingCode(): Promise<void> {
  if (!pendingEmail.value || pendingCodeBusy.value) return;
  pendingCodeBusy.value = true;
  try {
    await account.requestPendingOAuthEmailCode(pendingEmail.value);
    pushToast({ kind: "success", message: t("account.oauthCodeSent") });
  } catch {
    pushToast({ kind: "error", message: errorText(account.authErrorCode) });
  } finally {
    pendingCodeBusy.value = false;
  }
}

async function completePending(): Promise<void> {
  if (pendingCode.value.length !== 6 || pendingCompletionBusy.value) return;
  pendingCompletionBusy.value = true;
  try {
    await account.completePendingOAuth(pendingEmail.value, pendingCode.value);
    pushToast({ kind: "success", message: t("account.loginSuccess") });
    pendingEmail.value = "";
    pendingCode.value = "";
  } catch {
    pushToast({ kind: "error", message: errorText(account.authErrorCode) });
  } finally {
    pendingCompletionBusy.value = false;
  }
}

async function saveDisplayName(): Promise<void> {
  if (displayNameBusy.value) return;
  displayNameBusy.value = true;
  try {
    await account.updateDisplayName(displayNameDraft.value);
    pushToast({ kind: "success", message: t("account.displayNameSaved") });
  } catch {
    pushToast({ kind: "error", message: errorText("profile_update_failed") });
  } finally {
    displayNameBusy.value = false;
  }
}

async function onSync(): Promise<void> {
  if (syncButtonBusy.value) return;
  syncBusy.value = true;
  try {
    await account.syncNow();
    pushToast({ kind: "success", message: t("account.syncDone") });
  } catch {
    pushToast({ kind: "error", message: errorText(account.syncStatus.errorCode) });
  } finally {
    syncBusy.value = false;
  }
}

async function onLogout(): Promise<void> {
  if (account.authBusy) return;
  try {
    const outcome = await account.logout();
    pushToast({
      kind: "success",
      message: t(outcome === "revoked" ? "account.logoutDone" : "account.logoutLocalOnly"),
    });
  } catch {
    pushToast({ kind: "error", message: errorText(account.authErrorCode) });
  }
}

function onRestore(version: number): void {
  void confirm({
    title: t("account.snapshots.restoreTitle"),
    message: t("account.snapshots.restoreConfirm", { version }),
    confirmLabel: t("account.snapshots.restore"),
    cancelLabel: t("common.cancel"),
    variant: "danger",
    onConfirm: async () => {
      try {
        await account.restoreSnapshot(version);
        pushToast({ kind: "success", message: t("account.snapshots.restoreDone") });
        return true;
      } catch {
        pushToast({ kind: "error", message: errorText(account.syncStatus.errorCode) });
        return false;
      }
    },
  });
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

function onSnapshotPageChange(page: number): void {
  if (page < 1 || page > account.snapshotsTotalPages || page === account.snapshotsPage) return;
  void account.loadSnapshots(page, account.snapshotsPageSize);
}

function onSnapshotPageSizeChange(event: Event): void {
  const pageSize = Number((event.target as HTMLSelectElement).value);
  if (!pageSizeOptions.includes(pageSize) || pageSize === account.snapshotsPageSize) return;
  void account.loadSnapshots(1, pageSize);
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
        <section v-if="account.phase === 'initializing'" class="gg-section account__loading">
          <h3 class="gg-section-title">{{ t("account.title") }}</h3>
          <div class="account__loading-status" role="status" aria-live="polite">
            <span class="gg-sr-only">{{ t("load.loading") }}</span>
            <AppSkeleton :rows="5" />
          </div>
        </section>

        <section v-else-if="account.phase === 'sessionError'" class="gg-section account__session-error">
          <AppAlert variant="error" :title="t('account.sessionErrorTitle')">
            {{ errorText(account.authErrorCode) }}
          </AppAlert>
          <div class="account__actions account__actions--center">
            <AppButton
              variant="primary"
              :loading="sessionRetryBusy"
              :loading-label="t('load.loading')"
              @click="onInitialize"
            >
              <RefreshCw :size="16" aria-hidden="true" />
              {{ t("common.retry") }}
            </AppButton>
            <AppButton
              v-if="account.cloudConfigured"
              variant="secondary"
              :loading="sessionClearBusy"
              :loading-label="t('load.loading')"
              @click="onDiscardStoredSession"
            >
              <LogOut :size="16" aria-hidden="true" />
              {{ t("account.clearSession") }}
            </AppButton>
          </div>
        </section>

        <section v-else-if="account.phase === 'signedOut'" class="gg-section account__login">
          <div class="account__login-head">
            <span class="account__identity-icon" aria-hidden="true">
              <UserRound :size="18" />
            </span>
            <div>
              <h3 class="gg-section-title">{{ t("account.loginTitle") }}</h3>
              <p class="gg-hint account__subtitle">{{ t("account.loginSubtitle") }}</p>
            </div>
            <div class="account__endpoint">
              <label class="account__endpoint-label" for="account-endpoint">
                {{ t("account.endpointLabel") }}
              </label>
              <select
                id="account-endpoint"
                v-model="endpointChoice"
                class="gg-select"
                :disabled="endpointBusy"
                :aria-busy="endpointBusy || undefined"
                @change="onEndpointChange(endpointChoice)"
              >
                <option v-for="option in endpointOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <label v-if="endpointChoice === 'custom'" class="account__endpoint-label" for="account-custom-endpoint">
                {{ t("account.endpointLabel") }}
              </label>
              <input
                v-if="endpointChoice === 'custom'"
                id="account-custom-endpoint"
                v-model="customEndpointDraft"
                class="gg-input account__endpoint-input"
                type="url"
                inputmode="url"
                autocomplete="url"
                :disabled="endpointBusy"
                :aria-busy="endpointBusy || undefined"
                :placeholder="t('account.endpointPlaceholder')"
                @keydown.enter.prevent="applyCustomEndpoint"
                @blur="applyCustomEndpoint"
              />
            </div>
          </div>

          <AppAlert
            v-if="account.authErrorCode"
            class="account__auth-error"
            variant="error"
            :title="errorText(account.authErrorCode)"
          />

          <div class="account__login-grid">
            <div v-if="account.pendingOAuth" class="account__credentials">
              <form class="account__form" @submit.prevent="completePending">
                <h3>{{ t("account.oauthEmailTitle") }}</h3>
                <p class="account__provider-status">{{ t("account.oauthEmailHint") }}</p>
                <div class="gg-field">
                  <label class="gg-field-label" for="account-pending-email">{{ t("account.email") }}</label>
                  <input
                    id="account-pending-email"
                    v-model="pendingEmail"
                    class="gg-input"
                    type="email"
                    autocomplete="email"
                    :disabled="pendingCodeBusy || pendingCompletionBusy"
                    :placeholder="t('account.emailPlaceholder')"
                  />
                </div>
                <div class="gg-field">
                  <label class="gg-field-label" for="account-pending-code">{{ t("account.verificationCode") }}</label>
                  <div class="account__code-row">
                    <input
                      id="account-pending-code"
                      v-model="pendingCode"
                      class="gg-input"
                      maxlength="6"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      :disabled="pendingCodeBusy || pendingCompletionBusy"
                      :placeholder="t('account.verificationCode')"
                    />
                    <AppButton
                      type="button"
                      variant="secondary"
                      :disabled="!pendingEmail || pendingCompletionBusy"
                      :loading="pendingCodeBusy"
                      :loading-label="t('load.loading')"
                      @click="sendPendingCode"
                    >
                      {{ t("account.sendCode") }}
                    </AppButton>
                  </div>
                </div>
                <AppButton
                  type="submit"
                  variant="primary"
                  :disabled="pendingCode.length !== 6 || pendingCodeBusy"
                  :loading="pendingCompletionBusy"
                  :loading-label="t('load.loading')"
                >
                  {{ t("account.oauthEmailContinue") }}
                </AppButton>
              </form>
            </div>

            <div class="account__credentials">
              <form class="account__form" @submit.prevent="onSubmit">
                <div class="gg-field">
                  <label class="gg-field-label" for="account-email">{{ t("account.email") }}</label>
                  <input
                    id="account-email"
                    v-model="email"
                    class="gg-input"
                    type="email"
                    autocomplete="email"
                    :disabled="account.authBusy"
                    :placeholder="t('account.emailPlaceholder')"
                  />
                </div>
                <div class="gg-field">
                  <label class="gg-field-label" for="account-password">{{ t("account.password") }}</label>
                  <div class="account__password-field">
                    <input
                      id="account-password"
                      v-model="password"
                      class="gg-input account__password-input"
                      :type="passwordVisible ? 'text' : 'password'"
                      autocomplete="current-password"
                      :disabled="account.authBusy"
                      :placeholder="t('account.passwordPlaceholder')"
                    />
                    <button
                      type="button"
                      class="gg-icon-button account__password-toggle"
                      :aria-label="t('account.password')"
                      :aria-pressed="passwordVisible"
                      :disabled="account.authBusy"
                      :title="t('account.password')"
                      @click="passwordVisible = !passwordVisible"
                    >
                      <EyeOff v-if="passwordVisible" :size="18" aria-hidden="true" />
                      <Eye v-else :size="18" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <AppButton
                  class="account__submit"
                  type="submit"
                  variant="primary"
                  :loading="account.authBusy"
                  :loading-label="t('load.loading')"
                >
                  {{ t("account.login") }}
                </AppButton>
                <AppButton
                  class="account__register-link"
                  variant="quiet"
                  :disabled="!registrationUrl || account.authBusy"
                  :loading="registrationBusy"
                  :loading-label="t('load.loading')"
                  @click="onRegister"
                >
                  {{ t("account.register") }}
                </AppButton>
              </form>
            </div>

            <div
              v-if="account.providersLoading || account.providers.length || account.providersError"
              class="account__oauth-panel"
            >
              <p class="account__oauth-title">{{ t("account.or") }}</p>
              <div v-if="account.providersLoading" class="account__provider-loading" role="status" aria-live="polite">
                <AppSpinner :label="t('load.loading')" size="sm" />
                <AppSkeleton :rows="2" />
              </div>
              <div v-else-if="account.providers.length" class="account__oauth">
                <AppButton
                  v-for="provider in account.providers"
                  :key="provider"
                  variant="secondary"
                  :loading="account.authBusy"
                  :loading-label="t('load.loading')"
                  @click="onOAuth(provider)"
                >
                  {{ providerLabel(provider) }}
                </AppButton>
              </div>
              <div v-else class="account__provider-status" role="status">
                <Info :size="16" aria-hidden="true" />
                <span>{{ t("account.providersUnavailable") }}</span>
                <AppButton
                  variant="quiet"
                  size="sm"
                  :loading="account.providersLoading"
                  :loading-label="t('load.loading')"
                  @click="account.loadProviders()"
                >
                  {{ t("common.retry") }}
                </AppButton>
              </div>
            </div>
          </div>
        </section>

        <template v-else>
          <section class="gg-section account__profile">
            <div class="account__section-head">
              <h3 class="gg-section-title">{{ t("account.title") }}</h3>
              <AppBadge :variant="syncBadgeVariant">{{ syncStatusText }}</AppBadge>
            </div>

            <dl class="account__properties">
              <div class="account__row">
                <dt>{{ t("account.loggedInAs") }}</dt>
                <dd>{{ account.user?.email || t("account.providerAccount") }}</dd>
              </div>
              <div class="account__row">
                <dt><label for="account-display-name">{{ t("account.displayName") }}</label></dt>
                <dd>
                  <form class="account__display-name" @submit.prevent="saveDisplayName">
                    <input
                      id="account-display-name"
                      v-model="displayNameDraft"
                      class="gg-input"
                      :disabled="displayNameBusy"
                      :maxlength="32"
                      :placeholder="account.user?.displayName || account.user?.email || undefined"
                      @focus="displayNameDraft ||= account.user?.displayName || ''"
                    />
                    <AppButton
                      type="submit"
                      size="sm"
                      :loading="displayNameBusy"
                      :loading-label="t('load.loading')"
                    >
                      {{ t("common.save") }}
                    </AppButton>
                  </form>
                </dd>
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
                <dd>{{ account.syncStatus.serverVersion ?? t("account.notAvailable") }}</dd>
              </div>
            </dl>

            <AppAlert
              v-if="account.syncStatus.errorCode"
              :variant="account.syncStatus.phase === 'offline' ? 'info' : 'error'"
              :title="errorText(account.syncStatus.errorCode)"
            />

            <div class="account__actions">
              <AppButton
                variant="primary"
                :loading="syncButtonBusy"
                :loading-label="t('load.loading')"
                @click="onSync"
              >
                <RefreshCw :size="16" aria-hidden="true" />
                {{ t("account.syncNow") }}
              </AppButton>
              <AppButton
                variant="secondary"
                :loading="account.authBusy"
                :loading-label="t('load.loading')"
                @click="onLogout"
              >
                <LogOut :size="16" aria-hidden="true" />
                {{ t("account.logout") }}
              </AppButton>
            </div>
          </section>

          <section class="gg-section account__snapshots">
            <div class="account__section-head">
              <div>
                <h3 class="gg-section-title">{{ t("account.snapshots.title") }}</h3>
                <p class="gg-hint account__subtitle">{{ t("account.snapshots.subtitle") }}</p>
              </div>
              <button
                type="button"
                class="gg-icon-button"
                :disabled="account.snapshotsLoading"
                :aria-busy="account.snapshotsLoading || undefined"
                :aria-label="t('account.snapshots.refresh')"
                :title="t('account.snapshots.refresh')"
                @click="account.loadSnapshots()"
              >
                <AppSpinner v-if="account.snapshotsLoading" size="sm" />
                <RefreshCw v-else :size="18" aria-hidden="true" />
              </button>
            </div>

            <AppAlert
              v-if="account.snapshotsErrorCode"
              variant="error"
              :title="errorText(account.snapshotsErrorCode)"
            />

            <div v-if="account.snapshotsLoading && !account.snapshots.length" class="account__snapshot-loading" role="status" aria-live="polite">
              <AppSpinner :label="t('load.loading')" />
              <AppSkeleton :rows="4" />
            </div>
            <AppEmptyState
              v-else-if="!account.snapshots.length"
              :title="t('account.snapshots.empty')"
              :description="t('account.snapshots.subtitle')"
            />
            <div v-else class="gg-table-wrap account__table-wrap" :aria-busy="account.snapshotsLoading || undefined">
              <div v-if="account.snapshotsLoading" class="account__table-loading" role="status" aria-live="polite">
                <AppSpinner :label="t('load.loading')" size="sm" />
              </div>
              <table class="gg-table account__snapshots-table">
                <caption class="gg-sr-only">{{ t("account.snapshots.title") }}</caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t("account.snapshots.version") }}</th>
                    <th scope="col">{{ t("account.snapshots.time") }}</th>
                    <th v-if="!narrowLayout" scope="col">{{ t("account.snapshots.device") }}</th>
                    <th v-if="!narrowLayout" scope="col">{{ t("account.snapshots.size") }}</th>
                    <th v-if="!narrowLayout" scope="col">{{ t("account.snapshots.note") }}</th>
                    <th class="account__actions-cell" scope="col">{{ t("account.snapshots.actions") }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="snapshot in account.snapshots" :key="snapshot.version">
                    <td>{{ snapshot.version }}</td>
                    <td>
                      <div>{{ formatSnapshotTime(snapshot.createdAt) }}</div>
                      <div v-if="narrowLayout" class="account__snapshot-meta">
                        {{ snapshot.deviceName || t("account.snapshots.unknownDevice") }} / {{ formatBytes(snapshot.sizeBytes) }}
                      </div>
                      <div v-if="narrowLayout && snapshot.note" class="account__snapshot-note">
                        {{ snapshot.note }}
                      </div>
                    </td>
                    <td v-if="!narrowLayout">{{ snapshot.deviceName || t("account.snapshots.unknownDevice") }}</td>
                    <td v-if="!narrowLayout">{{ formatBytes(snapshot.sizeBytes) }}</td>
                    <td v-if="!narrowLayout" class="account__snapshot-note-cell">
                      {{ snapshot.note || t("account.snapshots.noteEmpty") }}
                    </td>
                    <td class="account__actions-cell">
                      <button
                        type="button"
                        class="gg-icon-button account__restore"
                        :data-testid="`account-snapshot-restore-${snapshot.version}`"
                        :disabled="account.syncStatus.phase === 'syncing'"
                        :aria-label="t('account.snapshots.restore')"
                        :title="t('account.snapshots.restore')"
                        @click="onRestore(snapshot.version)"
                      >
                        <RotateCcw :size="18" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <nav v-if="account.snapshotsTotal > 0" class="account__snapshots-pagination" :aria-label="t('account.snapshots.title')">
              <div class="account__page-size">
                <label for="account-snapshot-page-size">{{ t("account.snapshots.size") }}</label>
                <select
                  id="account-snapshot-page-size"
                  class="gg-select"
                  :value="account.snapshotsPageSize"
                  :disabled="account.snapshotsLoading"
                  @change="onSnapshotPageSizeChange"
                >
                  <option v-for="pageSize in pageSizeOptions" :key="pageSize" :value="pageSize">{{ pageSize }}</option>
                </select>
              </div>
              <div class="account__page-controls">
                <button
                  type="button"
                  class="gg-icon-button"
                  :disabled="account.snapshotsLoading || account.snapshotsPage <= 1"
                  :aria-label="t('common.back')"
                  :title="t('common.back')"
                  @click="onSnapshotPageChange(account.snapshotsPage - 1)"
                >
                  <ChevronLeft :size="18" aria-hidden="true" />
                </button>
                <template v-for="(page, index) in snapshotPageItems" :key="`${page ?? 'ellipsis'}-${index}`">
                  <span v-if="page === null" class="account__page-ellipsis" aria-hidden="true">...</span>
                  <button
                    v-else
                    type="button"
                    class="account__page-button"
                    :disabled="account.snapshotsLoading"
                    :aria-current="page === account.snapshotsPage ? 'page' : undefined"
                    @click="onSnapshotPageChange(page)"
                  >
                    {{ page }}
                  </button>
                </template>
                <button
                  type="button"
                  class="gg-icon-button"
                  :disabled="account.snapshotsLoading || account.snapshotsPage >= account.snapshotsTotalPages"
                  :aria-label="t('common.next')"
                  :title="t('common.next')"
                  @click="onSnapshotPageChange(account.snapshotsPage + 1)"
                >
                  <ChevronRight :size="18" aria-hidden="true" />
                </button>
              </div>
            </nav>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account {
  width: min(100%, 840px);
  min-width: 0;
}

.account__loading {
  min-height: 280px;
}

.account__loading-status,
.account__snapshot-loading,
.account__provider-loading {
  display: grid;
  gap: 12px;
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
  display: grid;
  min-width: 180px;
  gap: 4px;
  margin-left: auto;
}

.account__endpoint-label {
  color: var(--gg-text-muted);
  font-size: 12px;
}

.account__endpoint-input {
  width: 240px;
}

.account__identity-icon {
  display: inline-flex;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--gg-primary-soft);
  color: var(--gg-primary);
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

.account__code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.account__password-field {
  position: relative;
}

.account__password-input {
  padding-right: 48px;
}

.account__password-toggle {
  position: absolute;
  top: 0;
  right: 0;
}

.account__submit,
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
  border-left: 1px solid var(--gg-border);
}

.account__oauth-title {
  margin: 2px 0 14px;
  color: var(--gg-text);
  font-size: 13px;
  font-weight: 600;
}

.account__oauth {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.account__oauth :deep(.gg-button) {
  width: 100%;
}

.account__provider-status {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 0;
  color: var(--gg-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.account__provider-status > svg {
  flex: 0 0 auto;
  color: var(--gg-primary);
}

.account__provider-status span {
  min-width: 0;
  flex: 1 1 160px;
}

.account__actions--center {
  justify-content: center;
}

.account__session-error {
  display: grid;
  gap: 16px;
}

.account__section-head {
  display: flex;
  min-height: 32px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.account__properties {
  margin: 0;
}

.account__row {
  display: grid;
  min-height: 34px;
  grid-template-columns: minmax(110px, 0.35fr) minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--gg-border);
}

.account__row:last-child {
  border-bottom: 0;
}

.account__row dt {
  color: var(--gg-text-muted);
  font-size: 12px;
}

.account__row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.account__display-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.account__display-name :deep(.gg-input) {
  max-width: 260px;
}

.account__table-wrap {
  position: relative;
  max-width: 100%;
}

.account__snapshots-table {
  min-width: 560px;
}

.account__table-loading {
  position: sticky;
  top: 8px;
  z-index: 2;
  display: flex;
  width: max-content;
  margin: 8px auto -36px;
  padding: 5px 8px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
}

.account__actions-cell {
  width: 76px;
  text-align: right;
}

.account__restore {
  margin-left: auto;
}

.account__snapshot-meta {
  color: var(--gg-text-muted);
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.account__snapshot-note,
.account__snapshot-note-cell {
  overflow: hidden;
  color: var(--gg-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account__snapshot-note {
  font-size: 12px;
  line-height: 1.4;
}

.account__snapshots-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.account__page-size,
.account__page-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.account__page-size {
  color: var(--gg-text-muted);
  font-size: 12px;
}

.account__page-size .gg-select {
  width: auto;
  min-width: 76px;
}

.account__page-button {
  min-width: 40px;
  min-height: 40px;
  border: 1px solid var(--gg-border);
  border-radius: 6px;
  background: var(--gg-surface);
  color: var(--gg-text);
}

.account__page-button[aria-current="page"] {
  border-color: var(--gg-primary-border);
  background: var(--gg-primary-soft);
  color: var(--gg-primary);
  font-weight: 700;
}

.account__page-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.account__page-ellipsis {
  min-width: 20px;
  color: var(--gg-text-muted);
  text-align: center;
}

</style>
