import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/oauth/callback",
      name: "oauth-callback",
      component: () => import("../views/OAuthCallbackView.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      component: () => import("../layouts/ConsoleLayout.vue"),
      children: [
        {
          path: "",
          name: "overview",
          component: () => import("../views/OverviewView.vue"),
        },
        {
          path: "config",
          name: "config",
          component: () => import("../views/ConfigView.vue"),
        },
        {
          path: "devices",
          name: "devices",
          component: () => import("../views/DevicesView.vue"),
        },
        {
          path: "snapshots",
          name: "snapshots",
          component: () => import("../views/SnapshotsView.vue"),
        },
        {
          path: "security",
          name: "security",
          component: () => import("../views/SecurityView.vue"),
        },
        {
          path: "admin",
          name: "admin",
          component: () => import("../views/AdminView.vue"),
          meta: { admin: true },
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

// 路由守卫:未登录 → 登录页(带回跳地址)
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const auth = useAuthStore();
  if (await auth.ensureUser()) {
    if (to.meta.admin && auth.user?.role !== "admin") {
      return { name: "overview" };
    }
    return true;
  }
  return { name: "login", query: { redirect: to.fullPath } };
});
