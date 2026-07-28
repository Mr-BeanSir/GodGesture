import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "../en";
import zhCN from "../zh-CN";

function leafKeys(value: unknown, prefix: string): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("account locale messages", () => {
  it.each([
    ["zh-CN", zhCN],
    ["en", en],
  ] as const)("compiles every account message in %s", (locale, messages) => {
    const i18n = createI18n({
      legacy: false,
      locale,
      fallbackLocale: false,
      missingWarn: false,
      fallbackWarn: false,
      messages: { [locale]: messages },
    });

    for (const key of leafKeys(messages.account, "account")) {
      expect(() => i18n.global.t(key)).not.toThrow();
    }
  });
});
