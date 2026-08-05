import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import en from "../en";
import zhCN from "../zh-CN";

describe("Node plugin locale messages", () => {
  it.each([
    ["zh-CN", zhCN],
    ["en", en],
  ] as const)("compiles filesystem plugin guidance in %s", (locale, messages) => {
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages } });
    expect(i18n.global.t("command.nodePlugin.noPlugins")).not.toContain("command.nodePlugin");
    expect(i18n.global.t("plugins.openFolder")).not.toContain("plugins.openFolder");
    expect(i18n.global.t("plugins.subtitle")).toMatch(/VS Code|WebStorm/);
  });
});
