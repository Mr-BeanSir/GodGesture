import { describe, expect, it } from "vitest";
import type { GestureSpec } from "@godgesture/shared";
import { gestureInputs, gestureMnemonic, sameGesture } from "../mnemonic";

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
});
