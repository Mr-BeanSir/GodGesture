export interface paths {
    "/admin/system-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read redacted administrator system configuration */
        get: operations["getAdminSystemConfig"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update administrator system configuration */
        patch: operations["updateAdminSystemConfig"];
        trace?: never;
    };
    "/admin/system-config/rustfs/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test RustFS connectivity with effective or candidate settings */
        post: operations["testAdminRustFsConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/template-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read global public template submission limits */
        get: operations["getTemplatePolicy"];
        put?: never;
        /** Update global public template submission limits */
        post: operations["updateTemplatePolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listModerationTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/templates/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listTemplateReports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/templates/reports/{id}/{action}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["resolveTemplateReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/templates/versions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getModerationTemplateDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/templates/versions/{id}/{action}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["reviewTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List account metadata for administrators */
        get: operations["listAdminUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read editable account metadata for administrators */
        get: operations["getAdminUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update account profile, password, and template quota overrides */
        patch: operations["updateAdminUser"];
        trace?: never;
    };
    "/admin/users/{id}/revoke-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke all sessions for a user */
        post: operations["revokeAdminUserSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change a user role */
        post: operations["setAdminUserRole"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable or disable a user account */
        post: operations["setAdminUserState"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}/template-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getUserTemplatePolicy"];
        put?: never;
        post: operations["updateUserTemplatePolicy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/email-verification/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a registration email verification code */
        post: operations["requestRegistrationEmailCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
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
    "/auth/oauth/pending/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify an email and finish binding a pending OAuth identity */
        post: operations["completePendingOAuthBinding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oauth/pending/{id}/email-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a registration email code for a pending OAuth identity */
        post: operations["requestPendingOAuthEmailCode"];
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
    "/auth/password-reset/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a new password with a one-time email code */
        post: operations["confirmPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/password-reset/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request a password reset code without revealing account existence */
        post: operations["requestPasswordReset"];
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
    "/public/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listPublicTemplates"];
        put?: never;
        post: operations["submitPublicTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPublicTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/{id}/package": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPublicTemplatePackage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["submitPublicTemplateVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/{id}/versions/{versionNumber}/package": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPublicTemplateVersionPackage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listOwnedTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/templates/submission-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPublicTemplateSubmissionPolicy"];
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
    "/sync/config/index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read groups and application summaries without gesture lists */
        get: operations["getConfigIndex"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sync/config/scope/{scope}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the global or selected application gesture scope */
        get: operations["getConfigScope"];
        put?: never;
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
    "/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteOwnedTemplate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/{id}/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["reportTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/{id}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["withdrawTemplate"];
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
        AdminAccountStateRequest: {
            disabled: boolean;
        };
        AdminRoleRequest: {
            /** @enum {string} */
            role: "user" | "admin";
        };
        AdminSystemConfigResponse: {
            rustfs: {
                accessKeyConfigured: boolean;
                bucket: string;
                /** Format: uri */
                endpoint: string;
                publicDownloadTtlSec: number;
                region: string;
                secretKeyConfigured: boolean;
            };
            templatePolicy: {
                dailySubmissionLimit: number;
                hardDailySubmissionMax: number;
                hardPackageBytesMax: number;
                hardPendingVersionMax: number;
                hardPublishedMax: number;
                maxPackageBytes: number;
                pendingVersionLimit: number;
                publishedTemplateLimit: number;
            };
            /** Format: date-time */
            updatedAt: string;
        };
        AdminSystemConfigUpdateRequest: {
            rustfs?: {
                accessKey?: string;
                bucket?: string;
                /** Format: uri */
                endpoint?: string;
                publicDownloadTtlSec?: number;
                region?: string;
                secretKey?: string;
            };
            templatePolicy?: {
                dailySubmissionLimit?: number;
                maxPackageBytes?: number;
                pendingVersionLimit?: number;
                publishedTemplateLimit?: number;
            };
        };
        AdminUser: {
            /** Format: date-time */
            createdAt: string;
            deviceCount: number;
            disabled: boolean;
            displayName: string;
            /** Format: email */
            email: string | null;
            emailVerified: boolean;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastLoginAt: string | null;
            /** Format: date-time */
            lastUseAt: string | null;
            /** @enum {string} */
            role: "user" | "admin";
        };
        AdminUserDetail: {
            /** Format: date-time */
            createdAt: string;
            deviceCount: number;
            disabled: boolean;
            displayName: string;
            /** Format: email */
            email: string | null;
            emailVerified: boolean;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastLoginAt: string | null;
            /** Format: date-time */
            lastUseAt: string | null;
            linkedProviders: ("github" | "google" | "wechat" | "qq")[];
            passwordSet: boolean;
            /** @enum {string} */
            role: "user" | "admin";
            templatePolicy: {
                dailySubmissionLimit: number;
                maxPackageBytes: number;
                overrides: {
                    dailySubmissionLimit?: number;
                    maxPackageBytes?: number;
                    pendingVersionLimit?: number;
                    publishedTemplateLimit?: number;
                };
                pendingVersionLimit: number;
                publishedTemplateLimit: number;
                /** Format: uuid */
                userId: string;
            };
        };
        AdminUserListQuery: {
            email?: string;
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
        };
        AdminUserListResponse: {
            page: number;
            pageSize: number;
            total: number;
            totalPages: number;
            users: {
                /** Format: date-time */
                createdAt: string;
                deviceCount: number;
                disabled: boolean;
                displayName: string;
                /** Format: email */
                email: string | null;
                emailVerified: boolean;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                lastLoginAt: string | null;
                /** Format: date-time */
                lastUseAt: string | null;
                /** @enum {string} */
                role: "user" | "admin";
            }[];
        };
        AdminUserUpdateRequest: {
            dailySubmissionLimit?: number | null;
            displayName?: string;
            maxPackageBytes?: number | null;
            password?: string;
            pendingVersionLimit?: number | null;
            publishedTemplateLimit?: number | null;
        };
        ConfigDocument: {
            /** @default [] */
            apps: {
                /** @default true */
                gesturingEnabled: boolean;
                /** Format: uuid */
                groupId: string;
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default true */
                    enabled: boolean;
                    gesture: {
                        inputs?: ({
                            /** @enum {string} */
                            direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                            /** @enum {string} */
                            type: "stroke";
                        } | {
                            /** @enum {string} */
                            button: "left" | "middle" | "right" | "x1" | "x2";
                            /** @enum {string} */
                            type: "button";
                        } | {
                            /** @enum {string} */
                            direction: "forward" | "backward";
                            /** @enum {string} */
                            type: "wheel";
                        } | {
                            key: string;
                            /** @enum {string} */
                            type: "key";
                        })[];
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
            /** @default [] */
            boundaryIntents: {
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
                    /** @default true */
                    autoSetWorkingDir: boolean;
                    code: string;
                    /** @default true */
                    showWindow: boolean;
                    /** @enum {string} */
                    type: "powershell";
                } | {
                    /** Format: uuid */
                    pluginId: string;
                    /** @enum {string} */
                    type: "nodePlugin";
                } | {
                    /** @default 1 */
                    delta: number;
                    /** @enum {string} */
                    type: "audioVolume";
                };
                /** @default true */
                enabled: boolean;
                /** Format: uuid */
                id: string;
                name: string;
                /** @default 0 */
                order: number;
                origin: {
                    /** @enum {string} */
                    corner: "leftTop" | "rightTop" | "leftBottom" | "rightBottom";
                    /** @enum {string} */
                    kind: "hotCorner";
                } | {
                    /** @enum {string} */
                    edge: "left" | "top" | "right" | "bottom";
                    /** @enum {string} */
                    kind: "rubEdge";
                };
                /** @default [] */
                sequence: ({
                    /** @enum {string} */
                    direction: "forward" | "backward";
                    /** @enum {string} */
                    type: "wheel";
                } | {
                    /** @enum {string} */
                    button: "left" | "middle" | "right" | "x1" | "x2";
                    /** @enum {string} */
                    type: "button";
                } | {
                    /** @enum {string} */
                    direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                    /** @enum {string} */
                    type: "stroke";
                })[];
            }[];
            /**
             * @default 8
             * @enum {number}
             */
            formatVersion: 8;
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default true */
                    enabled: boolean;
                    gesture: {
                        inputs?: ({
                            /** @enum {string} */
                            direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                            /** @enum {string} */
                            type: "stroke";
                        } | {
                            /** @enum {string} */
                            button: "left" | "middle" | "right" | "x1" | "x2";
                            /** @enum {string} */
                            type: "button";
                        } | {
                            /** @enum {string} */
                            direction: "forward" | "backward";
                            /** @enum {string} */
                            type: "wheel";
                        } | {
                            key: string;
                            /** @enum {string} */
                            type: "key";
                        })[];
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
            /**
             * @default [
             *       {
             *         "id": "20000000-0000-4000-8000-000000000001",
             *         "name": "默认",
             *         "order": 0
             *       }
             *     ]
             */
            groups: {
                /** Format: uuid */
                id: string;
                name: string;
                /** @default 0 */
                order: number;
            }[];
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                    /** @default true */
                    disableInFullscreen: boolean;
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
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
        ConfigIndexResponse: {
            apps: {
                /** @default true */
                gesturingEnabled: boolean;
                /** Format: uuid */
                groupId: string;
                /** Format: uuid */
                id: string;
                /** @default true */
                inheritGlobalGestures: boolean;
                intentCount: number;
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
            boundaryIntentCount: number;
            global: {
                /** @default true */
                gesturingEnabled: boolean;
                intentCount: number;
            };
            groups: {
                /** Format: uuid */
                id: string;
                name: string;
                /** @default 0 */
                order: number;
            }[];
            hotCorners: {
                /** @default true */
                enabled: boolean;
            };
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
                    /** @default true */
                    disableInFullscreen: boolean;
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
            rubEdges: {
                /** @default true */
                enabled: boolean;
            };
            /** Format: date-time */
            updatedAt: string | null;
            version: number;
        };
        ConfigScopeResponse: {
            boundaryIntents: {
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
                    /** @default true */
                    autoSetWorkingDir: boolean;
                    code: string;
                    /** @default true */
                    showWindow: boolean;
                    /** @enum {string} */
                    type: "powershell";
                } | {
                    /** Format: uuid */
                    pluginId: string;
                    /** @enum {string} */
                    type: "nodePlugin";
                } | {
                    /** @default 1 */
                    delta: number;
                    /** @enum {string} */
                    type: "audioVolume";
                };
                /** @default true */
                enabled: boolean;
                /** Format: uuid */
                id: string;
                name: string;
                /** @default 0 */
                order: number;
                origin: {
                    /** @enum {string} */
                    corner: "leftTop" | "rightTop" | "leftBottom" | "rightBottom";
                    /** @enum {string} */
                    kind: "hotCorner";
                } | {
                    /** @enum {string} */
                    edge: "left" | "top" | "right" | "bottom";
                    /** @enum {string} */
                    kind: "rubEdge";
                };
                /** @default [] */
                sequence: ({
                    /** @enum {string} */
                    direction: "forward" | "backward";
                    /** @enum {string} */
                    type: "wheel";
                } | {
                    /** @enum {string} */
                    button: "left" | "middle" | "right" | "x1" | "x2";
                    /** @enum {string} */
                    type: "button";
                } | {
                    /** @enum {string} */
                    direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                    /** @enum {string} */
                    type: "stroke";
                })[];
            }[];
            scope: {
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
                            /** @default true */
                            autoSetWorkingDir: boolean;
                            code: string;
                            /** @default true */
                            showWindow: boolean;
                            /** @enum {string} */
                            type: "powershell";
                        } | {
                            /** Format: uuid */
                            pluginId: string;
                            /** @enum {string} */
                            type: "nodePlugin";
                        } | {
                            /** @default 1 */
                            delta: number;
                            /** @enum {string} */
                            type: "audioVolume";
                        };
                        /** @default true */
                        enabled: boolean;
                        gesture: {
                            inputs?: ({
                                /** @enum {string} */
                                direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                                /** @enum {string} */
                                type: "stroke";
                            } | {
                                /** @enum {string} */
                                button: "left" | "middle" | "right" | "x1" | "x2";
                                /** @enum {string} */
                                type: "button";
                            } | {
                                /** @enum {string} */
                                direction: "forward" | "backward";
                                /** @enum {string} */
                                type: "wheel";
                            } | {
                                key: string;
                                /** @enum {string} */
                                type: "key";
                            })[];
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
                /** @enum {string} */
                kind: "global";
            } | {
                app: {
                    /** @default true */
                    gesturingEnabled: boolean;
                    /** Format: uuid */
                    groupId: string;
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
                            /** @default true */
                            autoSetWorkingDir: boolean;
                            code: string;
                            /** @default true */
                            showWindow: boolean;
                            /** @enum {string} */
                            type: "powershell";
                        } | {
                            /** Format: uuid */
                            pluginId: string;
                            /** @enum {string} */
                            type: "nodePlugin";
                        } | {
                            /** @default 1 */
                            delta: number;
                            /** @enum {string} */
                            type: "audioVolume";
                        };
                        /** @default true */
                        enabled: boolean;
                        gesture: {
                            inputs?: ({
                                /** @enum {string} */
                                direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                                /** @enum {string} */
                                type: "stroke";
                            } | {
                                /** @enum {string} */
                                button: "left" | "middle" | "right" | "x1" | "x2";
                                /** @enum {string} */
                                type: "button";
                            } | {
                                /** @enum {string} */
                                direction: "forward" | "backward";
                                /** @enum {string} */
                                type: "wheel";
                            } | {
                                key: string;
                                /** @enum {string} */
                                type: "key";
                            })[];
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
                };
                /** @enum {string} */
                kind: "app";
            };
            version: number;
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
        ListSnapshotsQuery: {
            /** @default 1 */
            page: number;
            /** @default 10 */
            pageSize: number;
        };
        ListSnapshotsResponse: {
            page: number;
            pageSize: number;
            snapshots: {
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                deviceId: string | null;
                deviceName: string | null;
                /** @default  */
                note: string;
                sizeBytes: number;
                version: number;
            }[];
            total: number;
            totalPages: number;
        };
        LoginRequest: {
            device: {
                /** Format: uuid */
                deviceKey: string;
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
            displayName: string;
            /** Format: email */
            email: string | null;
            emailVerified: boolean;
            /** Format: uuid */
            id: string;
            linkedProviders: ("github" | "google" | "wechat" | "qq")[];
            /** @enum {string} */
            role: "user" | "admin";
        };
        OAuthExchangeRequest: {
            code: string;
            codeVerifier: string;
            device: {
                /** Format: uuid */
                deviceKey: string;
                name: string;
                /** @enum {string} */
                platform: "windows" | "macos" | "web";
            };
        };
        OAuthPendingBindingCompleteRequest: {
            codeVerifier: string;
            device: {
                /** Format: uuid */
                deviceKey: string;
                name: string;
                /** @enum {string} */
                platform: "windows" | "macos" | "web";
            };
            /** Format: email */
            email: string;
            verificationCode: string;
        };
        OAuthPendingBindingEmailCodeRequest: {
            /** Format: email */
            email: string;
        };
        OAuthProvidersResponse: {
            providers: ("github" | "google" | "wechat" | "qq")[];
        };
        OwnedTemplateListResponse: {
            templates: {
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
                versions: {
                    /** Format: uuid */
                    id: string;
                    /** Format: date-time */
                    publishedAt: string | null;
                    /** @enum {string} */
                    status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
                    /** Format: date-time */
                    submittedAt: string;
                    summary: string;
                    title: string;
                    versionNumber: number;
                }[];
            }[];
        };
        PasswordResetConfirmRequest: {
            /** Format: email */
            email: string;
            password: string;
            verificationCode: string;
        };
        PasswordResetRequest: {
            /** Format: email */
            email: string;
        };
        PublicTemplateCatalogPage: {
            entries: {
                author: string;
                downloadCount: number;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                publishedAt: string;
                risks: ("script" | "commandLine" | "fileOrProgram" | "externalUrl")[];
                summary: string;
                tags: string[];
                targets: ({
                    /** @enum {string} */
                    scope: "global";
                } | {
                    mac?: {
                        bundleId: string;
                    };
                    name: string;
                    /** @enum {string} */
                    scope: "app";
                    windows?: {
                        aumid?: string;
                        exactPath?: string;
                        exeName: string;
                        /** @default false */
                        matchByExactPath: boolean;
                    };
                })[];
                title: string;
                /** Format: date-time */
                updatedAt: string;
                versionNumber: number;
            }[];
            /** Format: uuid */
            nextCursor: string | null;
        };
        PublicTemplatePackageDownload: {
            packageHash: string;
            sizeBytes: number;
            /** Format: uri */
            url: string;
        };
        PublicTemplateSubmissionPolicy: {
            limits: {
                dailySubmissionLimit: number;
                maxPackageBytes: number;
                pendingVersionLimit: number;
                publishedTemplateLimit: number;
            };
            usage: {
                pendingVersions: number;
                publishedTemplates: number;
                submissionsToday: number;
            };
        };
        PublicTemplateSubmissionResponse: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
            versionNumber: number;
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
            verificationCode?: string;
        };
        RenameDeviceRequest: {
            name: string;
        };
        RequestEmailCodeRequest: {
            /** Format: email */
            email: string;
            /** @enum {string} */
            purpose: "register" | "resetPassword";
        };
        RequestEmailCodeResponse: {
            /** @enum {boolean} */
            accepted: true;
            expiresInSec: number;
            retryAfterSec: number;
        };
        RestoreSnapshotRequest: {
            baseVersion: number;
        };
        RestoreSnapshotResponse: {
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        RustFsConfigResponse: {
            accessKeyConfigured: boolean;
            bucket: string;
            /** Format: uri */
            endpoint: string;
            publicDownloadTtlSec: number;
            region: string;
            secretKeyConfigured: boolean;
        };
        RustFsConfigUpdateRequest: {
            accessKey?: string;
            bucket?: string;
            /** Format: uri */
            endpoint?: string;
            publicDownloadTtlSec?: number;
            region?: string;
            secretKey?: string;
        };
        SystemConfigRustFsTestRequest: {
            rustfs?: {
                accessKey?: string;
                bucket?: string;
                /** Format: uri */
                endpoint?: string;
                publicDownloadTtlSec?: number;
                region?: string;
                secretKey?: string;
            };
        };
        SystemConfigRustFsTestResponse: {
            /** @enum {boolean} */
            ok: true;
        };
        TemplateModerationDetailResponse: {
            targetDetails: ({
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default true */
                    enabled: boolean;
                    gesture: {
                        inputs?: ({
                            /** @enum {string} */
                            direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                            /** @enum {string} */
                            type: "stroke";
                        } | {
                            /** @enum {string} */
                            button: "left" | "middle" | "right" | "x1" | "x2";
                            /** @enum {string} */
                            type: "button";
                        } | {
                            /** @enum {string} */
                            direction: "forward" | "backward";
                            /** @enum {string} */
                            type: "wheel";
                        } | {
                            key: string;
                            /** @enum {string} */
                            type: "key";
                        })[];
                        /**
                         * @default none
                         * @enum {string}
                         */
                        modifier: "none" | "wheelForward" | "wheelBackward" | "leftButtonDown" | "middleButtonDown" | "rightButtonDown" | "x1Down" | "x2Down";
                        strokes: ("up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp")[];
                        /** @enum {string} */
                        trigger: "right" | "middle" | "x1" | "x2";
                    };
                    name: string;
                }[];
                /** @enum {string} */
                scope: "global";
            } | {
                /** @default true */
                gesturingEnabled: boolean;
                /** @default true */
                inheritGlobalGestures: boolean;
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
                        /** @default true */
                        autoSetWorkingDir: boolean;
                        code: string;
                        /** @default true */
                        showWindow: boolean;
                        /** @enum {string} */
                        type: "powershell";
                    } | {
                        /** Format: uuid */
                        pluginId: string;
                        /** @enum {string} */
                        type: "nodePlugin";
                    } | {
                        /** @default 1 */
                        delta: number;
                        /** @enum {string} */
                        type: "audioVolume";
                    };
                    /** @default true */
                    enabled: boolean;
                    gesture: {
                        inputs?: ({
                            /** @enum {string} */
                            direction: "up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp";
                            /** @enum {string} */
                            type: "stroke";
                        } | {
                            /** @enum {string} */
                            button: "left" | "middle" | "right" | "x1" | "x2";
                            /** @enum {string} */
                            type: "button";
                        } | {
                            /** @enum {string} */
                            direction: "forward" | "backward";
                            /** @enum {string} */
                            type: "wheel";
                        } | {
                            key: string;
                            /** @enum {string} */
                            type: "key";
                        })[];
                        /**
                         * @default none
                         * @enum {string}
                         */
                        modifier: "none" | "wheelForward" | "wheelBackward" | "leftButtonDown" | "middleButtonDown" | "rightButtonDown" | "x1Down" | "x2Down";
                        strokes: ("up" | "rightUp" | "right" | "rightDown" | "down" | "leftDown" | "left" | "leftUp")[];
                        /** @enum {string} */
                        trigger: "right" | "middle" | "x1" | "x2";
                    };
                    name: string;
                }[];
                mac?: {
                    bundleId: string;
                };
                name: string;
                /** @enum {string} */
                scope: "app";
                windows?: {
                    aumid?: string;
                    exactPath?: string;
                    exeName: string;
                    /** @default false */
                    matchByExactPath: boolean;
                };
            })[];
        };
        TemplateModerationListQuery: {
            /** Format: uuid */
            cursor?: string;
            /** @default 20 */
            limit: number;
            /** @default pending_review */
            status: "all" | ("pending_review" | "published" | "rejected" | "withdrawn" | "suspended");
        };
        TemplateModerationListResponse: {
            count: number;
            /** Format: uuid */
            nextCursor: string | null;
            templates: {
                author: string;
                risks: string[];
                /** @enum {string} */
                status: "pending_review" | "published" | "rejected" | "withdrawn" | "suspended";
                /** Format: date-time */
                submittedAt: string;
                summary: string;
                /** Format: uuid */
                templateId: string;
                title: string;
                /** Format: uuid */
                versionId: string;
                versionNumber: number;
            }[];
        };
        TemplateModerationReportListQuery: {
            /** Format: uuid */
            cursor?: string;
            /** @default 50 */
            limit: number;
            /**
             * @default open
             * @enum {string}
             */
            status: "open" | "resolved" | "dismissed";
        };
        TemplateModerationReportListResponse: {
            count: number;
            /** Format: uuid */
            nextCursor: string | null;
            reports: {
                author: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                reason: string;
                reporter: string;
                resolution: string | null;
                /** Format: date-time */
                resolvedAt: string | null;
                /** @enum {string} */
                status: "open" | "resolved" | "dismissed";
                /** Format: uuid */
                templateId: string;
                title: string;
                /** Format: uuid */
                versionId: string;
            }[];
        };
        TemplatePolicyResponse: {
            dailySubmissionLimit: number;
            hardDailySubmissionMax: number;
            hardPackageBytesMax: number;
            hardPendingVersionMax: number;
            hardPublishedMax: number;
            maxPackageBytes: number;
            pendingVersionLimit: number;
            publishedTemplateLimit: number;
        };
        TemplatePolicyUpdateRequest: {
            dailySubmissionLimit?: number;
            maxPackageBytes?: number;
            pendingVersionLimit?: number;
            publishedTemplateLimit?: number;
        };
        TemplateReportResolutionRequest: {
            resolution: string;
        };
        TemplateUserPolicyResponse: {
            dailySubmissionLimit: number;
            maxPackageBytes: number;
            overrides: {
                dailySubmissionLimit?: number;
                maxPackageBytes?: number;
                pendingVersionLimit?: number;
                publishedTemplateLimit?: number;
            };
            pendingVersionLimit: number;
            publishedTemplateLimit: number;
            /** Format: uuid */
            userId: string;
        };
        TemplateUserPolicyUpdateRequest: {
            dailySubmissionLimit?: number | null;
            maxPackageBytes?: number | null;
            pendingVersionLimit?: number | null;
            publishedTemplateLimit?: number | null;
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
    getAdminSystemConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The administrator system configuration. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminSystemConfigResponse"];
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
            403: {
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
    updateAdminSystemConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminSystemConfigUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated administrator system configuration. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminSystemConfigResponse"];
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
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
    testAdminRustFsConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemConfigRustFsTestRequest"];
            };
        };
        responses: {
            /** @description The RustFS connection test succeeded. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemConfigRustFsTestResponse"];
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
            403: {
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
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getTemplatePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template policy. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplatePolicyResponse"];
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
            403: {
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
    updateTemplatePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TemplatePolicyUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated template policy. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplatePolicyResponse"];
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
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
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
    listModerationTemplates: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                status?: "all" | ("pending_review" | "published" | "rejected" | "withdrawn" | "suspended");
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Template moderation versions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateModerationListResponse"];
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
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    listTemplateReports: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                status?: "open" | "resolved" | "dismissed";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Template reports. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateModerationReportListResponse"];
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
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    resolveTemplateReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                action: "resolved" | "dismissed";
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TemplateReportResolutionRequest"];
            };
        };
        responses: {
            /** @description The report was resolved. */
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
            403: {
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
        };
    };
    getModerationTemplateDetail: {
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
            /** @description Immutable template moderation detail. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateModerationDetailResponse"];
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
            403: {
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
        };
    };
    reviewTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                action: "approve" | "reject" | "suspend" | "restore";
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default  */
                    reason?: string;
                };
            };
        };
        responses: {
            /** @description The template review was applied. */
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
            403: {
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
        };
    };
    listAdminUsers: {
        parameters: {
            query?: {
                email?: string;
                page?: number;
                pageSize?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The account metadata list. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserListResponse"];
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
            403: {
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
    getAdminUser: {
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
            /** @description The account details. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDetail"];
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
            403: {
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
    updateAdminUser: {
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
                "application/json": components["schemas"]["AdminUserUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated account details. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminUserDetail"];
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
            403: {
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
    revokeAdminUserSessions: {
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
            /** @description The user sessions were revoked. */
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
            /** @description Request failed. */
            403: {
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
    setAdminUserRole: {
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
                "application/json": components["schemas"]["AdminRoleRequest"];
            };
        };
        responses: {
            /** @description The account role was updated. */
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
            403: {
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
    setAdminUserState: {
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
                "application/json": components["schemas"]["AdminAccountStateRequest"];
            };
        };
        responses: {
            /** @description The account state was updated. */
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
            403: {
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
    getUserTemplatePolicy: {
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
            /** @description The user template policy. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateUserPolicyResponse"];
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
            403: {
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
        };
    };
    updateUserTemplatePolicy: {
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
                "application/json": components["schemas"]["TemplateUserPolicyUpdateRequest"];
            };
        };
        responses: {
            /** @description The updated user template policy. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateUserPolicyResponse"];
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
            403: {
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
            /** @description Request failed. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    requestRegistrationEmailCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEmailCodeRequest"];
            };
        };
        responses: {
            /** @description The request was accepted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestEmailCodeResponse"];
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
    completePendingOAuthBinding: {
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
                "application/json": components["schemas"]["OAuthPendingBindingCompleteRequest"];
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
    requestPendingOAuthEmailCode: {
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
                "application/json": components["schemas"]["OAuthPendingBindingEmailCodeRequest"];
            };
        };
        responses: {
            /** @description The verification code was accepted for delivery. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestEmailCodeResponse"];
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
    confirmPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetConfirmRequest"];
            };
        };
        responses: {
            /** @description The password was changed and sessions revoked. */
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
    requestPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordResetRequest"];
            };
        };
        responses: {
            /** @description The request was accepted. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestEmailCodeResponse"];
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
    listPublicTemplates: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                platform?: "windows" | "macos";
                q?: string;
                risk?: "script" | "commandLine" | "fileOrProgram" | "externalUrl";
                sort?: "newest" | "downloads" | "trending";
                tag?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of public templates. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplateCatalogPage"];
                };
            };
            /** @description The catalog page has not changed. */
            304: {
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
    submitPublicTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    package?: unknown;
                };
            };
        };
        responses: {
            /** @description The submitted template. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplateSubmissionResponse"];
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
            403: {
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
    getPublicTemplate: {
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
            /** @description A public template. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
            /** @description The template has not changed. */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
        };
    };
    getPublicTemplatePackage: {
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
            /** @description A signed package URL. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplatePackageDownload"];
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
        };
    };
    submitPublicTemplateVersion: {
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
                "application/json": {
                    package?: unknown;
                };
            };
        };
        responses: {
            /** @description The submitted template version. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplateSubmissionResponse"];
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
            403: {
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
    getPublicTemplateVersionPackage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionNumber: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A signed package URL. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplatePackageDownload"];
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
        };
    };
    listOwnedTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The authenticated user template families and their retained versions. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OwnedTemplateListResponse"];
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
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    getPublicTemplateSubmissionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current account submission usage and limits. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicTemplateSubmissionPolicy"];
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
            403: {
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
    getConfigIndex: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The configuration index. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigIndexResponse"];
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
    getConfigScope: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scope: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The selected configuration scope. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigScopeResponse"];
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
    listSnapshots: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
            };
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
    deleteOwnedTemplate: {
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
            /** @description The owned template was deleted. */
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
            403: {
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
        };
    };
    reportTemplate: {
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
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description The report was submitted. */
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
        };
    };
    withdrawTemplate: {
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
            /** @description The template was withdrawn. */
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
            403: {
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
        };
    };
}
