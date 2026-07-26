/**
 * 助记符渲染:触发键符号 + 方向箭头串(+ 修饰符号)。
 * 与 CONTEXT.md 术语一致:触发键 right/middle/x1/x2,笔画 8 向。
 */
import type { GestureSpec, GestureModifier, StrokeDirection, TriggerButton } from "@godgesture/shared";

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

/** 完整助记符,如 "◑→↓" 或 "◑↑ +⇈" */
export function gestureMnemonic(gesture: GestureSpec): string {
  const base = `${TRIGGER_SYMBOLS[gesture.trigger]}${strokesMnemonic(gesture.strokes)}`;
  return gesture.modifier !== "none" ? `${base} +${MODIFIER_SYMBOLS[gesture.modifier]}` : base;
}

/** 手势唯一性:触发键 + 笔画序列 + 修饰 三者共同决定 */
export function sameGesture(a: GestureSpec, b: GestureSpec): boolean {
  return (
    a.trigger === b.trigger &&
    a.modifier === b.modifier &&
    a.strokes.length === b.strokes.length &&
    a.strokes.every((s, i) => s === b.strokes[i])
  );
}
