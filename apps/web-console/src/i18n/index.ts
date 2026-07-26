import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN";
import en from "./locales/en";

export type ConsoleLocale = "zh-CN" | "en";

const LOCALE_STORAGE_KEY = "godgesture.locale";

function detectLocale(): ConsoleLocale {
  const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (saved === "zh-CN" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "en",
  messages: { "zh-CN": zhCN, en },
});

export function setLocale(locale: ConsoleLocale): void {
  i18n.global.locale.value = locale;
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  document.title = i18n.global.t("app.title");
}
