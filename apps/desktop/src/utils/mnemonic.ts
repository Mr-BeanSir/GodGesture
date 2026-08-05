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

const TRIGGER_MODIFIERS: Record<TriggerButton, GestureModifier> = {
  right: "rightButtonDown",
  middle: "middleButtonDown",
  x1: "x1Down",
  x2: "x2Down",
};

export function isModifierForTrigger(
  trigger: TriggerButton,
  modifier: GestureModifier,
): boolean {
  return TRIGGER_MODIFIERS[trigger] === modifier;
}

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

/** 基础有序输入。独立修饰符不加入此序列。 */
export function gestureInputs(gesture: GestureSpec): GestureInput[] {
  if (gesture.inputs !== undefined) return gesture.inputs;
  return gesture.strokes.map((direction) => ({
    type: "stroke",
    direction,
  }));
}

/** 将独立修饰符转换为仅供助记符展示的输入图标。 */
export function gestureModifierInput(modifier: GestureModifier): GestureInput | null {
  switch (modifier) {
    case "wheelForward":
      return { type: "wheel", direction: "forward" };
    case "wheelBackward":
      return { type: "wheel", direction: "backward" };
    case "leftButtonDown":
      return { type: "button", button: "left" };
    case "middleButtonDown":
      return { type: "button", button: "middle" };
    case "rightButtonDown":
      return { type: "button", button: "right" };
    case "x1Down":
      return { type: "button", button: "x1" };
    case "x2Down":
      return { type: "button", button: "x2" };
    default:
      return null;
  }
}

/**
 * Re-recording keeps an existing independent modifier unless the new ordered
 * capture already contains the same physical input.
 */
export function preservedModifierForInputs(
  inputs: readonly GestureInput[],
  modifier: GestureModifier,
): GestureModifier {
  const modifierInput = gestureModifierInput(modifier);
  if (!modifierInput) return "none";
  return inputs.some((input) => sameInput(input, modifierInput)) ? "none" : modifier;
}

export function keyLabel(key: string): string {
  if (key.startsWith("Key") && key.length === 4) return key.slice(3);
  if (key.startsWith("Digit") && key.length === 6) return key.slice(5);
  if (key.startsWith("Numpad")) return `Num${key.slice(6)}`;
  if (key.startsWith("Arrow")) return key.slice(5);
  if (key.startsWith("Control")) return `Ctrl${key.slice(7)}`;
  if (key.startsWith("Meta")) return `Meta${key.slice(4)}`;
  return key;
}

function inputMnemonic(input: GestureInput): string {
  if (input.type === "stroke") return DIRECTION_ARROWS[input.direction];
  if (input.type === "button") return BUTTON_SYMBOLS[input.button];
  if (input.type === "wheel") return input.direction === "forward" ? "⇈" : "⇊";
  return `[${keyLabel(input.key)}]`;
}

/** 完整助记符,如 "◑→↓" 或 "◑→●"。 */
export function gestureMnemonic(gesture: GestureSpec): string {
  const modifier = gestureModifierInput(gesture.modifier);
  return `${TRIGGER_SYMBOLS[gesture.trigger]}${gestureInputs(gesture)
    .map(inputMnemonic)
    .join("")}${modifier ? inputMnemonic(modifier) : ""}`;
}

/** 手势唯一性:触发键 + 基础有序输入 + 独立修饰符。 */
export function sameGesture(a: GestureSpec, b: GestureSpec): boolean {
  if (a.modifier !== b.modifier) return false;
  const aInputs = gestureInputs(a);
  const bInputs = gestureInputs(b);
  return (
    a.trigger === b.trigger &&
    aInputs.length === bInputs.length &&
    aInputs.every((input, index) => sameInput(input, bInputs[index]))
  );
}

function sameInput(a: GestureInput, b: GestureInput): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "stroke":
      return a.direction === (b as Extract<GestureInput, { type: "stroke" }>).direction;
    case "button":
      return a.button === (b as Extract<GestureInput, { type: "button" }>).button;
    case "wheel":
      return a.direction === (b as Extract<GestureInput, { type: "wheel" }>).direction;
    case "key":
      return a.key === (b as Extract<GestureInput, { type: "key" }>).key;
  }
}
