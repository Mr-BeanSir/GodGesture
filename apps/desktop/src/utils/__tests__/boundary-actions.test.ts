import { describe, expect, it } from "vitest";
import type { BoundaryIntent, BoundaryToken } from "@godgesture/shared";
import { findBoundaryConflict } from "../boundary-actions";

const wheel: BoundaryToken = { type: "wheel", direction: "forward" };
const right: BoundaryToken = { type: "stroke", direction: "right" };

function intent(id: string, sequence: BoundaryToken[]): BoundaryIntent {
  return {
    id,
    name: id,
    origin: { kind: "hotCorner", corner: "leftTop" },
    sequence,
    command: { type: "doNothing" },
    order: 0,
  };
}

describe("boundary action conflicts", () => {
  it("distinguishes exact and prefix conflicts", () => {
    expect(
      findBoundaryConflict([intent("one", [wheel])], { kind: "hotCorner", corner: "leftTop" }, [wheel]),
    ).toMatchObject({ kind: "exact", intent: { id: "one" } });
    expect(
      findBoundaryConflict(
        [intent("long", [wheel, right])],
        { kind: "hotCorner", corner: "leftTop" },
        [wheel],
      ),
    ).toMatchObject({ kind: "prefix", intent: { id: "long" } });
  });

  it("ignores other origins and the edited intent", () => {
    expect(
      findBoundaryConflict(
        [intent("self", [wheel])],
        { kind: "hotCorner", corner: "leftTop" },
        [wheel],
        "self",
      ),
    ).toBeNull();
    expect(
      findBoundaryConflict(
        [intent("one", [wheel])],
        { kind: "hotCorner", corner: "rightTop" },
        [wheel],
      ),
    ).toBeNull();
  });

  it("treats empty immediate actions as prefixes", () => {
    expect(
      findBoundaryConflict(
        [intent("immediate", [])],
        { kind: "hotCorner", corner: "leftTop" },
        [wheel],
      ),
    ).toMatchObject({ kind: "prefix", intent: { id: "immediate" } });
  });
});
