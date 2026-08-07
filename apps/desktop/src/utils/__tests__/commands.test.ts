import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, createDefaultCommand } from "../commands";

describe("command helpers", () => {
  it("offers Node plugins without creating an unbound command", () => {
    expect(COMMAND_TYPES).toContain("nodePlugin");
    expect(COMMAND_TYPES).not.toContain("script");
    expect(() => createDefaultCommand("nodePlugin")).toThrow(
      "Node plugin commands require an existing plugin selection",
    );
  });

  it("creates an empty text DSL sequence", () => {
    expect(createDefaultCommand("sendText")).toEqual({
      type: "sendText",
      text: 'text ""',
    });
  });

  it("creates distinct cmd and PowerShell commands", () => {
    expect(createDefaultCommand("cmd")).toEqual({
      type: "cmd",
      code: "",
      showWindow: true,
      autoSetWorkingDir: true,
    });
    expect(createDefaultCommand("powershell")).toEqual({
      type: "powershell",
      code: "",
      showWindow: true,
      autoSetWorkingDir: true,
    });
  });
});
