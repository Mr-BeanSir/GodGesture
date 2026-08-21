# Web Registration Toggle Design

**Goal:** Let an administrator enable or disable new account registration from the Web Console while preserving all existing-account authentication paths.

**Architecture:** Store the policy in the existing `SystemConfig` singleton, expose it through the shared protocol and the existing admin system-config endpoint, and enforce it in the Server before any new user can be created. The Web Console uses an anonymous status endpoint for presentation only; the Server remains authoritative.

**Tech Stack:** pnpm workspace, `@godgesture/shared` Zod/OpenAPI types, NestJS, Prisma/PostgreSQL, Server-owned Vue/Vite Web Console, Vue i18n, and the existing shared UI primitives.

## Semantics

- The default is enabled for existing installations and fresh databases.
- When disabled, `AuthService.register` rejects new email/password account creation and the registration-code endpoint does not send or consume a code.
- When disabled, a first-time unbound OAuth identity cannot create a new user.
- When disabled, an OAuth pending-binding code is issued only when the submitted email already belongs to an existing account; unknown emails do not receive a registration-purpose code.
- An unbound OAuth identity may still complete email verification and bind to an already existing, non-disabled GodGesture account.
- Already-bound OAuth identities continue to log in.
- Existing users continue to log in and use password reset.
- The Server returns `registration_disabled` for blocked new-account operations.
- The policy is a runtime database setting and takes effect without process restart.

## Shared Protocol

Add:

- `RegistrationStatusResponse = { enabled: boolean }` for `GET /api/v1/auth/registration`.
- `registrationEnabled: boolean` to `AdminSystemConfigResponse`.
- Optional `registrationEnabled: boolean` to `AdminSystemConfigUpdateRequest`.
- `registration_disabled` to the shared/auth error contract as a stable literal where error-code unions are used.

The generated API/OpenAPI artifacts and all consumers must be regenerated and checked from the root workspace.

## Server

Add `registrationEnabled Boolean @default(true)` to `SystemConfig` with a Prisma migration. Existing rows are backfilled as enabled.

Use a small authentication-facing policy reader backed by `PrismaService` so Auth and OAuth do not import the Admin module. A missing legacy `SystemConfig` row reads as enabled; the existing admin system-config bootstrap creates the row with the database default.

Expose `GET auth/registration` without authentication. Extend the existing admin system-config response and patch transaction to read and update the policy, and add an audit metadata field indicating whether registration changed.

Enforce the policy at both email/password entry points:

- `requestRegistrationCode` checks before issuing a verification code.
- `register` checks before consuming a code or creating a user.

In `OAuthService.completePendingEmailBinding`, resolve the target email first. If it maps to an existing non-disabled user, preserve the current binding flow regardless of the policy. If no user exists and registration is disabled, reject before creating the user. The already-bound exchange path is unchanged.

Apply the same existing-user check in `requestPendingEmailCode`: an existing account may receive the binding code while registration is closed, while an unknown email receives `registration_disabled`. The completion path repeats the check so an administrator toggle cannot be bypassed between code request and completion.

## Web Console

- Add a binary registration switch to `/admin/system`, using existing shared UI primitives and `zh-CN` i18n keys. It is saved together with the existing system configuration and remains populated when panels collapse.
- Load the anonymous registration status on `LoginView`.
- When disabled, hide the registration tab.
- If an old link requests registration, show the localized “registration is closed” alert and return to login after the status is known.
- Map `registration_disabled` to the same localized message so stale pages and direct API calls have a clear result.
- Do not hide OAuth providers globally because existing bound OAuth and existing-account binding must remain available.

## Testing

- Shared protocol tests validate default/invalid registration status and admin update payloads.
- Server unit tests cover system-config default/read/update/audit, registration-code rejection, password-registration rejection before code consumption, OAuth pending-code rejection for unknown emails, OAuth new-user rejection, OAuth existing-user binding, and existing bound OAuth login.
- Server controller/API tests cover the anonymous status endpoint and the stable error payload.
- Web Console API tests cover the new status and admin fields.
- `SystemConfigView` tests cover loading, toggling, saving, and persistence across panel state changes.
- `LoginView` tests cover hidden registration tab, stale register deep-link fallback, localized closed notice, and unaffected login/OAuth rendering.
- Run `pnpm check:api`, Server tests/typecheck/Web Console tests/build, and focused shared tests.

## Compatibility and Documentation

The database default preserves current behavior. No OAuth credentials or secrets enter shared types, UI, logs, or documentation. Once implementation and verification are complete, update `docs/PROJECT_STATUS.md` in the same domain commit to record the new admin-controlled registration gate and its test baseline.
