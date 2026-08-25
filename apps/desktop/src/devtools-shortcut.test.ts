import { describe, expect, it } from "vitest";
import { isDevtoolsShortcut } from "./devtools-shortcut";

describe("DevTools shortcut", () => {
  it("recognizes F12 by key or code", () => {
    expect(isDevtoolsShortcut({ key: "F12", code: "" })).toBe(true);
    expect(isDevtoolsShortcut({ key: "", code: "F12" })).toBe(true);
  });

  it("does not treat other keys as the DevTools shortcut", () => {
    expect(isDevtoolsShortcut({ key: "F11", code: "F11" })).toBe(false);
  });
});
