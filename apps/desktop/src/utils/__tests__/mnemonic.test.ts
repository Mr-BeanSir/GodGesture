import { describe, expect, it } from "vitest";
import type { GestureSpec } from "@godgesture/shared";
import {
  gestureInputs,
  gestureMnemonic,
  isModifierForTrigger,
  preservedModifierForInputs,
  sameGesture,
} from "../mnemonic";

function gesture(inputs: GestureSpec["inputs"]): GestureSpec {
  return {
    trigger: "right",
    strokes: inputs?.filter((input) => input.type === "stroke").map((input) => input.direction) ?? [],
    modifier: "none",
    inputs,
  };
}

describe("gesture mnemonic input sequence", () => {
  it("keeps button and stroke order", () => {
    const value = gesture([
      { type: "button", button: "middle" },
      { type: "stroke", direction: "right" },
    ]);

    expect(gestureInputs(value)).toEqual(value.inputs);
    expect(gestureMnemonic(value)).toBe("◑●→");
  });

  it("treats reordered inputs as a different gesture", () => {
    const buttonThenStroke = gesture([
      { type: "button", button: "middle" },
      { type: "stroke", direction: "right" },
    ]);
    const strokeThenButton = gesture([
      { type: "stroke", direction: "right" },
      { type: "button", button: "middle" },
    ]);

    expect(sameGesture(buttonThenStroke, strokeThenButton)).toBe(false);
  });

  it("keeps keyboard inputs in the sequence and identity", () => {
    const withQ = gesture([
      { type: "key", key: "KeyQ" },
      { type: "stroke", direction: "right" },
    ]);
    const withW = gesture([
      { type: "key", key: "KeyW" },
      { type: "stroke", direction: "right" },
    ]);

    expect(gestureMnemonic(withQ)).toBe("◑[Q]→");
    expect(sameGesture(withQ, withQ)).toBe(true);
    expect(sameGesture(withQ, withW)).toBe(false);
  });

  it("includes the independent modifier in display and identity", () => {
    const plain = gesture([{ type: "stroke", direction: "right" }]);
    const repeated = {
      ...plain,
      modifier: "wheelBackward" as const,
    };

    expect(gestureInputs(repeated)).toEqual([
      { type: "stroke", direction: "right" },
    ]);
    expect(gestureMnemonic(repeated)).toBe("◑→⇊");
    expect(sameGesture(plain, repeated)).toBe(false);
  });

  it("identifies the trigger button's invalid modifier option", () => {
    expect(isModifierForTrigger("right", "rightButtonDown")).toBe(true);
    expect(isModifierForTrigger("right", "middleButtonDown")).toBe(false);
  });

  it("clears a preserved modifier when the new recording captures that input", () => {
    expect(
      preservedModifierForInputs(
        [{ type: "button", button: "left" }],
        "leftButtonDown",
      ),
    ).toBe("none");
    expect(
      preservedModifierForInputs(
        [{ type: "button", button: "left" }],
        "middleButtonDown",
      ),
    ).toBe("middleButtonDown");
  });
});
