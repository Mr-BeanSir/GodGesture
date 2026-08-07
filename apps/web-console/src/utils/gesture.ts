import type {
  GestureInput,
  GestureSpec,
  StrokeDirection,
  TriggerButton,
} from "@godgesture/shared";

/** 触发键符号:右键◑ 中键● X1/X2 */
const TRIGGER_SYMBOLS: Record<TriggerButton, string> = {
  right: "◑",
  middle: "●",
  x1: "X1",
  x2: "X2",
};

/** 8 方向箭头 */
const STROKE_ARROWS: Record<StrokeDirection, string> = {
  up: "↑",
  rightUp: "↗",
  right: "→",
  rightDown: "↘",
  down: "↓",
  leftDown: "↙",
  left: "←",
  leftUp: "↖",
};

const BUTTON_SYMBOLS: Record<
  Extract<GestureInput, { type: "button" }>["button"],
  string
> = {
  left: "◐",
  middle: "●",
  right: "◑",
  x1: "X1",
  x2: "X2",
};

function keyLabel(key: string): string {
  if (key.startsWith("Key") && key.length === 4) return key.slice(3);
  if (key.startsWith("Digit") && key.length === 6) return key.slice(5);
  if (key.startsWith("Numpad")) return `Num${key.slice(6)}`;
  if (key.startsWith("Arrow")) return key.slice(5);
  if (key.startsWith("Control")) return `Ctrl${key.slice(7)}`;
  if (key.startsWith("Meta")) return `Meta${key.slice(4)}`;
  return key;
}

function inputMnemonic(input: GestureInput): string {
  if (input.type === "stroke") return STROKE_ARROWS[input.direction];
  if (input.type === "button") return BUTTON_SYMBOLS[input.button];
  if (input.type === "wheel") return input.direction === "forward" ? "⇈" : "⇊";
  return `[${keyLabel(input.key)}]`;
}

function modifierMnemonic(modifier: GestureSpec["modifier"]): string {
  switch (modifier) {
    case "wheelForward":
      return "⇈";
    case "wheelBackward":
      return "⇊";
    case "leftButtonDown":
      return BUTTON_SYMBOLS.left;
    case "middleButtonDown":
      return BUTTON_SYMBOLS.middle;
    case "rightButtonDown":
      return BUTTON_SYMBOLS.right;
    case "x1Down":
      return BUTTON_SYMBOLS.x1;
    case "x2Down":
      return BUTTON_SYMBOLS.x2;
    default:
      return "";
  }
}

/** 手势助记符:触发键符号 + 实际输入顺序 + 独立修饰符。 */
export function gestureMnemonic(gesture: GestureSpec): string {
  const inputs = gesture.inputs ?? gesture.strokes.map((direction) => ({
    type: "stroke" as const,
    direction,
  }));
  const sequence = inputs.map(inputMnemonic).join("");
  const modifier = modifierMnemonic(gesture.modifier);
  const suffix = `${sequence}${modifier}`;
  return suffix ? `${TRIGGER_SYMBOLS[gesture.trigger]} ${suffix}` : TRIGGER_SYMBOLS[gesture.trigger];
}
