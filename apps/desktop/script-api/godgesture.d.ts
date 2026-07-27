type TriggerButton = "right" | "middle" | "x1" | "x2";
type GestureModifier =
  | "none"
  | "wheelForward"
  | "wheelBackward"
  | "leftButtonDown"
  | "middleButtonDown"
  | "rightButtonDown"
  | "x1Down"
  | "x2Down";
type ScriptPhase =
  | "init"
  | "execute"
  | "gestureRecognized"
  | "modifierTriggered"
  | "gestureEnded";
type MouseButton = "left" | "right" | "middle" | "x1" | "x2";
type WindowOperation =
  | "maximizeRestore"
  | "minimize"
  | "close"
  | "toggleTopmost"
  | "dockLeft"
  | "dockRight";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface InputApi {
  keyCombo(modifiers: string[], keys: string[]): void;
  sendText(text: string): void;
  mouseClick(button: MouseButton): void;
  mouseDown(button: MouseButton): void;
  mouseUp(button: MouseButton): void;
  movePointer(x: number, y: number): void;
  /** One standard wheel notch is 120. */
  wheel(delta: number): void;
}

interface GestureContextApi {
  readonly origin: Point;
  readonly endpoint: Point;
  readonly triggerButton: TriggerButton | null;
  readonly modifier: GestureModifier;
  readonly phase: ScriptPhase;
  readonly targetWindowAvailable: boolean;
  activateTargetWindow(): void;
}

interface WindowApi {
  perform(operation: WindowOperation): void;
}

interface ClipboardApi {
  readText(): string | null;
  writeText(text: string): void;
  selectedText(): string | null;
}

declare const Input: InputApi;
declare const Context: GestureContextApi;
declare const Window: WindowApi;
declare const Clipboard: ClipboardApi;
declare function ReportStatus(status: string): void;
