import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = join(process.cwd(), "src", "views", "LogsView.vue");

describe("LogsView shared UI migration contract", () => {
  it("uses shared notification and confirmation primitives instead of Element Plus", async () => {
    const source = await readFile(sourcePath, "utf8");

    expect(source).toContain('from "@godgesture/ui"');
    expect(source).toContain("useConfirmDialog");
    expect(source).toContain("pushToast");
    const forbiddenContracts = [
      ["element", "plus"].join("-"),
      ["@element", "plus/icons-vue"].join("-"),
      ["<", "el"].join("") + "-",
      ["El", "Message"].join(""),
      ["El", "Message", "Box"].join(""),
      ["", "", "el"].join("-") + "-",
    ];
    expect(source).not.toMatch(new RegExp(forbiddenContracts.join("|"), "i"));
  });
});
