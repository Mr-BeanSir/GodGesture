import { defineStore } from "pinia";
import { ref } from "vue";
import type { MeResponse } from "@godgesture/shared";
import { fetchMe, logout as apiLogout } from "../api/auth";
import { clearSession, hasStoredSession } from "../api/client";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<MeResponse | null>(null);

  /** 路由守卫用:仅明确会话失效时视为未登录;瞬时错误保留会话。 */
  async function ensureUser(): Promise<boolean> {
    if (user.value) return true;
    if (!hasStoredSession()) return false;
    try {
      user.value = await fetchMe();
      return true;
    } catch {
      return hasStoredSession();
    }
  }

  async function refreshUser(): Promise<void> {
    user.value = await fetchMe();
  }

  async function logout(): Promise<void> {
    await apiLogout();
    user.value = null;
  }

  /** 会话过期/被踢下线后的本地清理(不再请求服务端) */
  function resetLocal(): void {
    clearSession();
    user.value = null;
  }

  /** client 已用 compare-and-remove 清理失效 token;这里不再二次动 storage。 */
  function markSessionExpired(): void {
    user.value = null;
  }

  return {
    user,
    ensureUser,
    refreshUser,
    logout,
    resetLocal,
    markSessionExpired,
  };
});
