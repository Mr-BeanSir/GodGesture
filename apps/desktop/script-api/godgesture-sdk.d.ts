declare module "@godgesture/sdk" {
  export type TriggerButton = "right" | "middle" | "x1" | "x2";
  export type Modifier =
    | "none"
    | "wheelForward"
    | "wheelBackward"
    | "leftButtonDown"
    | "middleButtonDown"
    | "rightButtonDown"
    | "x1Down"
    | "x2Down";
  export type LifecyclePhase =
    | "onInit"
    | "onExecute"
    | "onGestureRecognized"
    | "onModifierTriggered"
    | "onEnd";
  export type MouseButton = "left" | "right" | "middle" | "x1" | "x2";
  export type WindowOperation =
    | "maximizeRestore"
    | "minimize"
    | "close"
    | "toggleTopmost"
    | "dockLeft"
    | "dockRight";
  export interface Point { readonly x: number; readonly y: number; }
  export interface InputApi {
    keyCombo(modifiers: readonly string[], keys: readonly string[]): Promise<void>;
    sendText(text: string): Promise<void>;
    mouseClick(button: MouseButton): Promise<void>;
    mouseDown(button: MouseButton): Promise<void>;
    mouseUp(button: MouseButton): Promise<void>;
    movePointer(x: number, y: number): Promise<void>;
    wheel(delta: number): Promise<void>;
  }
  export interface WindowApi {
    activateTarget(): Promise<void>;
    perform(operation: WindowOperation): Promise<void>;
  }
  export interface ClipboardApi {
    readText(): Promise<string | null>;
    writeText(text: string): Promise<void>;
    selectedText(): Promise<string | null>;
  }
  export interface StatusApi { report(message: string): Promise<void>; }
  export interface PluginContext {
    readonly origin: Point;
    readonly endpoint: Point;
    readonly triggerButton: TriggerButton | null;
    readonly modifier: Modifier;
    readonly phase: LifecyclePhase;
    readonly targetWindowAvailable: boolean;
    readonly input: InputApi;
    readonly window: WindowApi;
    readonly clipboard: ClipboardApi;
    readonly status: StatusApi;
  }
  export type PluginHandler<Result = unknown> = (context: PluginContext) => Result | Promise<Result>;
  export interface PluginLifecycle {
    onInit?: PluginHandler;
    onExecute?: PluginHandler;
    onGestureRecognized?: PluginHandler;
    onModifierTriggered?: PluginHandler;
    onEnd?: PluginHandler;
  }
  export function defineHandler<Result>(handler: PluginHandler<Result>): PluginHandler<Result>;
}
