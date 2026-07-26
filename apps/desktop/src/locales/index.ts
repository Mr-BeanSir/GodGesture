import { createI18n } from "vue-i18n";
import zhCN from "./zh-CN";
import en from "./en";

export type AppLocale = "zh-CN" | "en";

/** 系统语言 -> 支持的语言 */
export function resolveSystemLocale(): AppLocale {
  const lang = typeof navigator !== "undefined" ? navigator.language : "en";
  return lang.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** 配置值(auto | zh-CN | en)-> 实际语言 */
export function resolveLocale(setting: "auto" | AppLocale): AppLocale {
  return setting === "auto" ? resolveSystemLocale() : setting;
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveSystemLocale(),
  fallbackLocale: "en",
  messages: {
    "zh-CN": zhCN,
    en,
  },
});

export function setLocale(locale: AppLocale) {
  i18n.global.locale.value = locale;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}
