import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  isSection,
  resolveInitialSection,
} from "../shell";

describe("desktop shell navigation contract", () => {
  it("keeps the product navigation order stable", () => {
    expect(SECTION_IDS).toEqual([
      "gestures",
      "templates",
      "plugins",
      "logs",
      "account",
      "options",
      "about",
    ]);
  });

  it("accepts only known deep-link section identifiers", () => {
    expect(isSection("templates")).toBe(true);
    expect(isSection("unknown")).toBe(false);
    expect(isSection(null)).toBe(false);
  });

  it("uses a valid section query and falls back for an unknown query", () => {
    expect(resolveInitialSection("?section=logs")).toBe("logs");
    expect(resolveInitialSection("?section=unknown")).toBe("gestures");
  });

});
