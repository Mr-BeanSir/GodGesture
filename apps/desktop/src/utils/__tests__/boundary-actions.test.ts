import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import type { BoundaryIntent, BoundaryToken } from "@godgesture/shared";
import { cloneBoundarySequence, findBoundaryConflict, reorderBoundarySequence } from "../boundary-actions";

const wheel: BoundaryToken = { type: "wheel", direction: "forward" };
const right: BoundaryToken = { type: "stroke", direction: "right" };

describe("boundary sequence ordering", () => {
  it("moves one token without mutating the source", () => {
    const middle: BoundaryToken = { type: "button", button: "middle" };
    const source = [wheel, right, middle];

    expect(reorderBoundarySequence(source, 0, 2)).toEqual([right, middle, wheel]);
    expect(source).toEqual([wheel, right, middle]);
  });
});

function intent(id: string, sequence: BoundaryToken[]): BoundaryIntent {
  return {
    id,
    name: id,
    enabled: true,
    origin: { kind: "hotCorner", corner: "leftTop" },
    sequence,
    command: { type: "doNothing" },
    order: 0,
  };
}

describe("boundary action conflicts", () => {
  it("copies Vue reactive sequences into plain cloneable tokens", () => {
    const sequence = reactive<BoundaryToken[]>([wheel, right]);

    expect(() => structuredClone(sequence)).toThrow();
    const copy = cloneBoundarySequence(sequence);
    expect(copy).toEqual([wheel, right]);
    expect(copy).not.toBe(sequence);
    expect(copy[0]).not.toBe(sequence[0]);
    expect(() => structuredClone(copy)).not.toThrow();
  });

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

  it("allows an immediate fallback beside a non-empty sequence", () => {
    expect(
      findBoundaryConflict(
        [intent("immediate", [])],
        { kind: "hotCorner", corner: "leftTop" },
        [wheel],
      ),
    ).toBeNull();
    expect(
      findBoundaryConflict(
        [intent("wheel", [wheel])],
        { kind: "hotCorner", corner: "leftTop" },
        [],
      ),
    ).toBeNull();
  });

  it("keeps duplicate immediate actions as exact conflicts", () => {
    expect(
      findBoundaryConflict(
        [intent("immediate", [])],
        { kind: "hotCorner", corner: "leftTop" },
        [],
      ),
    ).toMatchObject({ kind: "exact", intent: { id: "immediate" } });
  });
});
