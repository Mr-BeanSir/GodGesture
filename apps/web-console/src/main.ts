import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import App from "./App.vue";
import { router } from "./router";
import { i18n, setLocale } from "./i18n";
import { setupSystemTheme } from "./theme";
import { setSessionExpiredHandler } from "./api/client";
import { useAuthStore } from "./stores/auth";
import "./styles.css";

setupSystemTheme();

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(i18n);
app.use(ElementPlus);

// 初始 locale 同步到 <html lang> 与标题
setLocale(i18n.global.locale.value as "zh-CN" | "en");

// refresh 失效(会话过期/被踢下线)→ 清理并跳登录
setSessionExpiredHandler(() => {
  useAuthStore(pinia).markSessionExpired();
  if (router.currentRoute.value.name !== "login") {
    void router.replace({ name: "login" });
  }
});

app.mount("#app");
