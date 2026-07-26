import type {
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

/** 手势助记符:触发键符号 + 方向箭头序列,如 "◑ ↓→" */
export function gestureMnemonic(gesture: GestureSpec): string {
  const arrows = gesture.strokes.map((s) => STROKE_ARROWS[s]).join("");
  return arrows ? `${TRIGGER_SYMBOLS[gesture.trigger]} ${arrows}` : TRIGGER_SYMBOLS[gesture.trigger];
}
