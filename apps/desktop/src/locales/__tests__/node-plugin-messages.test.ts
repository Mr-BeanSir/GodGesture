import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "../en";
import zhCN from "../zh-CN";

describe("Node plugin locale messages", () => {
  it.each([
    ["zh-CN", zhCN],
    ["en", en],
  ] as const)("compiles literal SDK package names in %s", (locale, messages) => {
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages } });
    expect(i18n.global.t("command.nodePlugin.noDependencies")).toContain("@godgesture/sdk");
  });
});
