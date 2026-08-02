/**
 * 助记符渲染:触发键符号 + 实际输入顺序(方向、鼠标键和滚轮)。
 * 与 CONTEXT.md 术语一致:触发键 right/middle/x1/x2,笔画 8 向。
 */
import type {
  GestureInput,
  GestureSpec,
  GestureModifier,
  StrokeDirection,
  TriggerButton,
} from "@godgesture/shared";

export const TRIGGER_SYMBOLS: Record<TriggerButton, string> = {
  right: "◑",
  middle: "●",
  x1: "X1",
  x2: "X2",
};

export const DIRECTION_ARROWS: Record<StrokeDirection, string> = {
  up: "↑",
  rightUp: "↗",
  right: "→",
  rightDown: "↘",
  down: "↓",
  leftDown: "↙",
  left: "←",
  leftUp: "↖",
};

/** 修饰的紧凑符号(语言无关) */
export const MODIFIER_SYMBOLS: Record<GestureModifier, string> = {
  none: "",
  wheelForward: "⇈",
  wheelBackward: "⇊",
  leftButtonDown: "◐",
  middleButtonDown: "●",
  rightButtonDown: "◑",
  x1Down: "X1",
  x2Down: "X2",
};

export function strokesMnemonic(strokes: readonly StrokeDirection[]): string {
  return strokes.map((s) => DIRECTION_ARROWS[s]).join("");
}

export const BUTTON_SYMBOLS: Record<Extract<GestureInput, { type: "button" }>["button"], string> = {
  left: "◐",
  middle: "●",
  right: "◑",
  x1: "X1",
  x2: "X2",
};

/** 将旧字段或新输入序列规范化为显示顺序。触发键不包含在序列内。 */
export function gestureInputs(gesture: GestureSpec): GestureInput[] {
  if (gesture.inputs !== undefined) return gesture.inputs;

  const inputs: GestureInput[] = gesture.strokes.map((direction) => ({
    type: "stroke",
    direction,
  }));
  switch (gesture.modifier) {
    case "wheelForward":
      inputs.push({ type: "wheel", direction: "forward" });
      break;
    case "wheelBackward":
      inputs.push({ type: "wheel", direction: "backward" });
      break;
    case "leftButtonDown":
      inputs.push({ type: "button", button: "left" });
      break;
    case "middleButtonDown":
      inputs.push({ type: "button", button: "middle" });
      break;
    case "rightButtonDown":
      inputs.push({ type: "button", button: "right" });
      break;
    case "x1Down":
      inputs.push({ type: "button", button: "x1" });
      break;
    case "x2Down":
      inputs.push({ type: "button", button: "x2" });
      break;
  }
  return inputs;
}

function inputMnemonic(input: GestureInput): string {
  if (input.type === "stroke") return DIRECTION_ARROWS[input.direction];
  if (input.type === "button") return BUTTON_SYMBOLS[input.button];
  return input.direction === "forward" ? "⇈" : "⇊";
}

/** 完整助记符,如 "◑→↓" 或 "◑→●"。 */
export function gestureMnemonic(gesture: GestureSpec): string {
  return `${TRIGGER_SYMBOLS[gesture.trigger]}${gestureInputs(gesture).map(inputMnemonic).join("")}`;
}

/** 手势唯一性:触发键 + 有序输入序列共同决定。 */
export function sameGesture(a: GestureSpec, b: GestureSpec): boolean {
  const aInputs = gestureInputs(a);
  const bInputs = gestureInputs(b);
  return (
    a.trigger === b.trigger &&
    aInputs.length === bInputs.length &&
    aInputs.every((input, index) => {
      const other = bInputs[index];
      return input.type === other.type &&
        (input.type === "stroke"
          ? other.type === "stroke" && input.direction === other.direction
          : input.type === "button"
            ? other.type === "button" && input.button === other.button
            : other.type === "wheel" && input.direction === other.direction);
    })
  );
}
