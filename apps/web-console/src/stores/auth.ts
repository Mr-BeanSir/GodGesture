import { defineStore } from "pinia";
import { ref } from "vue";
import type { MeResponse } from "@godgesture/shared";
import { fetchMe, logout as apiLogout, type LogoutOutcome } from "../api/auth";
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
    } catch (err) {
      if (!hasStoredSession()) return false;
      // A transient failure must preserve the stored session, but it cannot
      // authorize a route without a successfully loaded user.
      throw err;
    }
  }

  async function refreshUser(): Promise<void> {
    user.value = await fetchMe();
  }

  async function logout(): Promise<LogoutOutcome> {
    const outcome = await apiLogout();
    user.value = null;
    return outcome;
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

  /** 其他标签页主动登出后的内存清理;client 已条件化移除 token。 */
  function markSessionLoggedOut(): void {
    user.value = null;
  }

  return {
    user,
    ensureUser,
    refreshUser,
    logout,
    resetLocal,
    markSessionExpired,
    markSessionLoggedOut,
  };
});
