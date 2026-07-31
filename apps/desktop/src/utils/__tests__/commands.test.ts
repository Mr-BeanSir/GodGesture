import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, createDefaultCommand } from "../commands";

describe("command helpers", () => {
  it("offers Node plugins without creating an unbound command", () => {
    expect(COMMAND_TYPES).toContain("nodePlugin");
    expect(() => createDefaultCommand("nodePlugin")).toThrow(
      "Node plugin commands require an existing plugin selection",
    );
  });
});
