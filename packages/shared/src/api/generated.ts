export interface paths {
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Log in and register a device */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke refresh tokens for the current device */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the current account */
        get: operations["getCurrentAccount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth/{provider}/authorize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Redirect to an OAuth provider authorization page */
        get: operations["authorizeOAuth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth/{provider}/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Handle a provider callback and redirect to the client */
        get: operations["handleOAuthCallback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth/exchange": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exchange a one-time OAuth code for a token pair */
        post: operations["exchangeOAuthCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List enabled OAuth providers */
        get: operations["listOAuthProviders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rotate a refresh token and issue a new token pair */
        post: operations["refreshTokenPair"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Register an account with email and password */
        post: operations["registerAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List account devices */
        get: operations["listDevices"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a device and revoke its access */
        delete: operations["removeDevice"];
        options?: never;
        head?: never;
        /** Rename an account device */
        patch: operations["renameDevice"];
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Service health check */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Pull the current configuration document */
        get: operations["pullConfig"];
        /** Push a configuration document with version CAS */
        put: operations["pushConfig"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/snapshots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List retained configuration snapshots */
        get: operations["listSnapshots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/snapshots/{version}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore a snapshot as a new configuration version */
        post: operations["restoreSnapshot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ConfigDocument: {
            /** @default [] */
            apps: {
                /** @default true */
                gesturingEnabled: boolean;
                /** Format: uuid */
                id: string;
                /** @default true */
                inheritGlobalGestures: boolean;
                /** @default [] */
                intents: {
                    command: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default false */
                    executeOnModifier: boolean;
                    gesture: {
                        /**
                         * @default none
                         * @enum {string}
                         */
                        modifier: "none" | "wheelForward" | "wheelBackward" | "leftButtonDown" | "middleButtonDown" | "rightButtonDown" | "x1Down" | "x2Down";
                        strokes: ("up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp")[];
                        /** @enum {string} */
                        trigger: "right" | "middle" | "x1" | "x2";
                    };
                    /** Format: uuid */
                    id: string;
                    name: string;
                    /** @default 0 */
                    order: number;
                }[];
                mac?: {
                    bundleId: string;
                };
                name: string;
                /** @default 0 */
                order: number;
                windows?: {
                    aumid?: string;
                    exactPath?: string;
                    exeName: string;
                    /** @default false */
                    matchByExactPath: boolean;
                };
            }[];
            /**
             * @default 1
             * @enum {number}
             */
            formatVersion: 1;
            /** @default {} */
            global: {
                /** @default true */
                gesturingEnabled: boolean;
                /** @default [] */
                intents: {
                    command: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default false */
                    executeOnModifier: boolean;
                    gesture: {
                        /**
                         * @default none
                         * @enum {string}
                         */
                        modifier: "none" | "wheelForward" | "wheelBackward" | "leftButtonDown" | "middleButtonDown" | "rightButtonDown" | "x1Down" | "x2Down";
                        strokes: ("up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp")[];
                        /** @enum {string} */
                        trigger: "right" | "middle" | "x1" | "x2";
                    };
                    /** Format: uuid */
                    id: string;
                    name: string;
                    /** @default 0 */
                    order: number;
                }[];
            };
            /** @default {} */
            hotCorners: {
                /** @default {} */
                commands: {
                    leftBottom?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    leftTop?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    rightBottom?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    rightTop?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                };
                /** @default true */
                enabled: boolean;
            };
            /** @default {} */
            preferences: {
                /** @default true */
                autoCheckForUpdate: boolean;
                /** @default {} */
                gestureView: {
                    /** @default true */
                    fadeOut: boolean;
                    /** @default #FF2DE0FF */
                    middleButtonPathColor: string;
                    /** @default #FF27E518 */
                    rightButtonPathColor: string;
                    /** @default true */
                    showCommandName: boolean;
                    /** @default true */
                    showPath: boolean;
                    /** @default #FFFF8040 */
                    unrecognizedPathColor: string;
                    /** @default #FF667EE9 */
                    xButtonPathColor: string;
                };
                /**
                 * @default auto
                 * @enum {string}
                 */
                locale: "auto" | "zh-CN" | "en";
                /** @default {} */
                pathTracker: {
                    /** @default false */
                    disableInFullscreen: boolean;
                    /** @default true */
                    enable8Directions: boolean;
                    /** @default false */
                    enableWindowsKeyGesturing: boolean;
                    /** @default false */
                    initialStayTimeout: boolean;
                    /** @default 200 */
                    initialStayTimeoutMs: number;
                    /** @default 4 */
                    initialValidMovePx: number;
                    /** @default true */
                    preferCursorWindow: boolean;
                    /** @default false */
                    stayTimeout: boolean;
                    /** @default 500 */
                    stayTimeoutMs: number;
                    /**
                     * @default [
                     *       "right",
                     *       "middle",
                     *       "x1",
                     *       "x2"
                     *     ]
                     */
                    triggerButtons: ("right" | "middle" | "x1" | "x2")[];
                };
                /** @default {} */
                pauseHotkey: {
                    /** @default w */
                    key: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash") | "";
                    /**
                     * @default [
                     *       "ctrl",
                     *       "shift",
                     *       "alt"
                     *     ]
                     */
                    modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                };
            };
            /** @default {} */
            rubEdges: {
                /** @default {} */
                commands: {
                    bottom?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    left?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    right?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    top?: {
                        /** @enum {string} */
                        type: "doNothing";
                    } | {
                        keys: ("a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16" | "f17" | "f18" | "f19" | "f20" | "f21" | "f22" | "f23" | "f24" | "backspace" | "tab" | "clear" | "enter" | "pauseBreak" | "capsLock" | "esc" | "space" | "pageUp" | "pageDown" | "end" | "home" | "left" | "up" | "right" | "down" | "printScreen" | "insert" | "delete" | "contextMenu" | "sleep" | "numpad0" | "numpad1" | "numpad2" | "numpad3" | "numpad4" | "numpad5" | "numpad6" | "numpad7" | "numpad8" | "numpad9" | "numpadMultiply" | "numpadAdd" | "numpadSeparator" | "numpadSubtract" | "numpadDecimal" | "numpadDivide" | "numpadEnter" | "numpadEqual" | "numLock" | "scrollLock" | "browserBack" | "browserForward" | "browserRefresh" | "browserStop" | "browserSearch" | "browserFavorites" | "browserHome" | "volumeMute" | "volumeDown" | "volumeUp" | "mediaNextTrack" | "mediaPrevTrack" | "mediaStop" | "mediaPlayPause" | "launchMail" | "launchMediaSelect" | "launchApp1" | "launchApp2" | "semicolon" | "equals" | "comma" | "minus" | "period" | "slash" | "backquote" | "bracketLeft" | "backslash" | "bracketRight" | "quote" | "intlBackslash")[];
                        modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
                        /** @enum {string} */
                        type: "hotKey";
                    } | {
                        /** @default null */
                        browser: string | null;
                        engineName: string;
                        engineUrl: string;
                        /** @enum {string} */
                        type: "webSearch";
                    } | {
                        /** @enum {string} */
                        operation: "maximizeRestore" | "minimize" | "close" | "toggleTopmost" | "dockLeft" | "dockRight";
                        /** @enum {string} */
                        type: "windowControl";
                    } | {
                        /** @enum {string} */
                        type: "taskSwitcher";
                    } | {
                        path: string;
                        /** @enum {string} */
                        type: "openFile";
                    } | {
                        text: string;
                        /** @enum {string} */
                        type: "sendText";
                    } | {
                        /** @enum {string} */
                        type: "gotoUrl";
                        url: string;
                    } | {
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "cmd";
                    } | {
                        /** @default  */
                        gestureEndedScript: string;
                        /** @default  */
                        gestureRecognizedScript: string;
                        /** @default false */
                        handleModifiers: boolean;
                        /** @default  */
                        initScript: string;
                        /**
                         * @default js
                         * @enum {string}
                         */
                        language: "js" | "lua";
                        /** @default  */
                        modifierTriggeredScript: string;
                        /** @default  */
                        script: string;
                        /** @enum {string} */
                        type: "script";
                    } | {
                        /** @enum {string} */
                        type: "pause";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                };
                /** @default true */
                enabled: boolean;
            };
        };
        ConfigTooLargeResponse: {
            /** @enum {string} */
            error: "config_too_large";
            maxBytes: number;
        };
        ErrorResponse: {
            error: string;
            message?: string | string[];
        };
        ListDevicesResponse: {
            devices: {
                /** Format: date-time */
                createdAt: string;
                current: boolean;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                lastSeenAt: string | null;
                name: string;
                /** @enum {string} */
                platform: "windows" | "macos" | "web";
            }[];
        };
        ListSnapshotsResponse: {
            snapshots: {
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                deviceId: string | null;
                deviceName: string | null;
                sizeBytes: number;
                version: number;
            }[];
        };
        LoginRequest: {
            device: {
                name: string;
                /** @enum {string} */
                platform: "windows" | "macos" | "web";
            };
            /** Format: email */
            email: string;
            password: string;
        };
        MeResponse: {
            /** Format: date-time */
            createdAt: string;
            /** Format: email */
            email: string | null;
            /** Format: uuid */
            id: string;
            linkedProviders: ("github" | "google" | "wechat" | "qq")[];
        };
        OAuthExchangeRequest: {
            code: string;
            codeVerifier: string;
            device: {
                name: string;
                /** @enum {string} */
                platform: "windows" | "macos" | "web";
            };
        };
        OAuthProvidersResponse: {
            providers: ("github" | "google" | "wechat" | "qq")[];
        };
        PullConfigResponse: {
            document: components["schemas"]["ConfigDocument"] & unknown;
            /** Format: date-time */
            updatedAt: string | null;
            /** Format: uuid */
            updatedByDeviceId: string | null;
            version: number;
        };
        PushConfigRequest: {
            baseVersion: number;
            document: components["schemas"]["ConfigDocument"];
        };
        PushConfigResponse: {
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        PushConflictResponse: {
            /** @enum {string} */
            error: "version_conflict";
            serverVersion: number;
        };
        RateLimitedResponse: {
            /** @enum {string} */
            error: "rate_limited";
        };
        RefreshRequest: {
            refreshToken: string;
        };
        RefreshRotationRaceResponse: {
            /** @enum {string} */
            error: "refresh_rotation_race";
        };
        RegisterRequest: {
            /** Format: email */
            email: string;
            password: string;
        };
        RenameDeviceRequest: {
            name: string;
        };
        RestoreSnapshotRequest: {
            baseVersion: number;
        };
        RestoreSnapshotResponse: {
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        TokenPairResponse: {
            accessToken: string;
            accessTokenExpiresIn: number;
            refreshToken: string;
        };
        ValidationErrorResponse: {
            /** @enum {string} */
            error: "validation_failed";
            issues: {
                message: string;
                path: string;
            }[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description A token pair was issued. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPairResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current device was logged out. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    getCurrentAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current account. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    authorizeOAuth: {
        parameters: {
            query: {
                code_challenge: string;
                code_challenge_method: "S256";
                redirect_uri: string;
                state?: string;
            };
            header?: never;
            path: {
                provider: "github" | "google" | "wechat" | "qq";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redirect to the provider authorization page. */
            302: {
                headers: {
                    location: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
            /** @description Request failed. */
            501: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    handleOAuthCallback: {
        parameters: {
            query?: {
                code?: string;
                error?: string;
                state?: string;
            };
            header?: never;
            path: {
                provider: "github" | "google" | "wechat" | "qq";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redirect to the validated client callback URI. */
            302: {
                headers: {
                    location: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    exchangeOAuthCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OAuthExchangeRequest"];
            };
        };
        responses: {
            /** @description A token pair was issued. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPairResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    listOAuthProviders: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The enabled provider list. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OAuthProvidersResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    refreshTokenPair: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshRequest"];
            };
        };
        responses: {
            /** @description A replacement token pair was issued. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPairResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Another request already rotated this refresh token. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefreshRotationRaceResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    registerAccount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description The account was created. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MeResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    listDevices: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account device list. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListDevicesResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    removeDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The device was removed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    renameDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameDeviceRequest"];
            };
        };
        responses: {
            /** @description The device was renamed. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service is healthy. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "ok";
                    };
                };
            };
        };
    };
    pullConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current configuration state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PullConfigResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    pushConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PushConfigRequest"];
            };
        };
        responses: {
            /** @description The new configuration version. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushConfigResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The base version is stale. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushConflictResponse"];
                };
            };
            /** @description The configuration document exceeds the protocol limit. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigTooLargeResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    listSnapshots: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The retained snapshot list. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ListSnapshotsResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
    restoreSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                version: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestoreSnapshotRequest"];
            };
        };
        responses: {
            /** @description The new configuration version. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreSnapshotResponse"];
                };
            };
            /** @description Request validation failed. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationErrorResponse"];
                };
            };
            /** @description Request failed. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Request failed. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description The base version is stale. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PushConflictResponse"];
                };
            };
            /** @description The request rate limit was exceeded. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RateLimitedResponse"];
                };
            };
        };
    };
}
