/**
 * 账户与同步 store(骨架):M6 前为纯 mock 逻辑,不与后端通信。
 */
import { defineStore } from "pinia";
import { ref } from "vue";

export type OAuthProvider = "github" | "google" | "wechat" | "qq";

export interface MockUser {
  email: string;
  provider: OAuthProvider | "password";
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const useAccountStore = defineStore("account", () => {
  const user = ref<MockUser | null>(null);
  const deviceName = ref("DESKTOP-DEV");
  const lastSyncAt = ref<Date | null>(null);
  const syncing = ref(false);
  const loggingIn = ref(false);

  async function loginWithPassword(email: string, _password: string) {
    loggingIn.value = true;
    try {
      await delay(600);
      user.value = { email, provider: "password" };
      lastSyncAt.value = new Date();
    } finally {
      loggingIn.value = false;
    }
  }

  async function loginWithOAuth(provider: OAuthProvider) {
    loggingIn.value = true;
    try {
      await delay(600);
      user.value = { email: `demo@${provider}.example`, provider };
      lastSyncAt.value = new Date();
    } finally {
      loggingIn.value = false;
    }
  }

  async function syncNow() {
    if (syncing.value) return;
    syncing.value = true;
    try {
      await delay(900);
      lastSyncAt.value = new Date();
    } finally {
      syncing.value = false;
    }
  }

  function logout() {
    user.value = null;
    lastSyncAt.value = null;
  }

  return {
    user,
    deviceName,
    lastSyncAt,
    syncing,
    loggingIn,
    loginWithPassword,
    loginWithOAuth,
    syncNow,
    logout,
  };
});
