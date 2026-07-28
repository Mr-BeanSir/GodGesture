# M6 Desktop Account And Cloud Sync Design

Date: 2026-07-28

## Goal

Complete M6 by replacing the desktop account mock with the real Server
contract and by making the local `ConfigDocument` participate in whole-document
cloud synchronization. The result remains local-first: an account is optional,
local configuration and gesture execution work offline, and transient network
failures never block local saves or clear a valid session.

M6 is complete when the desktop application provides:

- password registration and login against the configured Server;
- OAuth login for the providers that the Server reports as enabled;
- durable device-scoped session restoration and explicit logout;
- debounced automatic pushes, startup and 30-minute pulls, and manual sync;
- automatic `409 version_conflict` pull-and-repush behavior;
- restart-safe detection of local changes made while offline;
- desktop snapshot viewing and confirmed restoration;
- observable pending, syncing, current, offline, error, and expired-session
  states in both supported languages;
- focused TypeScript and Rust tests plus the affected build and lint gates.

External OAuth credentials and a production API domain remain deployment
configuration. Their absence does not justify a mock or a hard-coded value.
M4 physical-Mac acceptance, M7 updater/template distribution, and Web Console
changes remain outside this milestone.

## Chosen Architecture

Three implementation boundaries were considered:

1. Keep HTTP, authentication, and synchronization in the desktop Vue layer,
   while Rust owns only native secrets, the OAuth loopback receiver, and local
   device identity. This reuses the generated shared client and existing Pinia
   configuration store without exposing the refresh token to WebView storage.
2. Move the complete cloud client into Rust. This would give a fully native
   background worker, but it would duplicate the shared TypeScript/OpenAPI
   contract and require a second response-validation and retry stack.
3. Keep everything in the WebView and store the refresh token in
   `localStorage`. This is the smallest code change, but weakens credential
   handling and cannot implement the Server's RFC 8252 loopback flow cleanly.

Option 1 is selected. The Tauri settings WebView is created for the life of the
single application instance even when its window is hidden, so its timers can
own the low-frequency synchronization schedule. Rust remains the authority for
configuration persistence and runtime application through the existing
`config_set` command.

The new units have narrow responsibilities:

- a desktop cloud API wrapper uses `createGodGestureApiClient`, validates every
  success body with the existing shared Zod schema, and converts typed HTTP
  failures to one stable desktop error shape;
- a session manager keeps the access token in memory, rotates refresh tokens
  through a native credential vault, deduplicates concurrent refreshes, and
  retries one authenticated request after a `401`;
- a synchronization engine owns version/baseline state, scheduling, conflict
  recovery, snapshots, and serialization of cloud operations;
- the account Pinia store adapts those units to reactive UI state;
- the existing configuration store exposes explicit flush and remote-apply
  barriers so cloud operations cannot race its 500 ms local-save debounce;
- a focused Rust account module owns the OS credential entry, OAuth loopback
  listener, local sync metadata file, and device identity commands.

## Server Configuration And Transport

The desktop build accepts `VITE_API_BASE_URL` as the Server origin and appends
`/api/v1`. Development may default to `http://127.0.0.1:3000`; a production
build without an origin surfaces a localized `server_not_configured` state and
does not guess a public service. An `apps/desktop/.env.example` documents the
slot. The Server already permits the Windows and macOS Tauri origins through
CORS, so no Server behavior change is planned.

The generated client is instantiated twice against the same origin: public
authentication calls use a plain fetch, while authenticated calls use a custom
fetch supplied by the session manager. The authenticated fetch attaches the
current Bearer token, restores or refreshes the session when necessary, and
replays a clone of the request once after a `401`. Network failures and invalid
response shapes are distinct from authentication invalidation.

All requests have a bounded timeout. Transient refresh failures preserve the
stored refresh token. Only explicit invalid/expired/reused refresh responses,
a confirmed second authenticated `401`, device revocation, or explicit logout
clears the local session.

## Native Session Boundary

The refresh token is stored as one generic credential scoped to GodGesture and
the configured API origin. Windows uses Credential Manager and macOS uses
Keychain through a maintained cross-platform Rust credential library. The
access token never leaves memory and is not written to `config.json`,
`machine.json`, `sync-state.json`, `localStorage`, logs, or error messages.

Credential reads, writes, and deletes are Tauri commands executed away from
the UI thread. A successful login is published to the UI only after the refresh
token has been stored. If persistence fails after the Server issued a device
session, the client best-effort revokes that device session and reports a
localized credential-store error rather than pretending the login is durable.
Refresh rotation likewise stores the replacement before exposing it; a store
failure clears the in-memory session and best-effort revokes the new pair.

Browser-only Vite preview uses an in-memory implementation of the same backend
interface. It never claims durable login and remains suitable for UI tests.

On application startup, the account store reads the native credential. When
present, it refreshes the pair, fetches `/auth/me`, and starts synchronization.
An unavailable Server leaves a recoverable session state; an invalid credential
returns to the signed-out state. Logout attempts `/auth/logout`, then always
clears native credentials and stops all synchronization timers. A failed remote
logout is reported as local-only logout because offline logout must still work.

## OAuth Desktop Flow

OAuth follows the Server's existing RFC 8252 and PKCE contract:

1. The frontend generates a random PKCE verifier/challenge and client state.
2. Rust binds an ephemeral `127.0.0.1` port and returns a unique attempt ID and
   redirect URI before any browser is opened.
3. The frontend opens the Server authorize URL in the system browser with the
   redirect URI, state, S256 challenge, and selected enabled provider.
4. The Rust listener accepts only the expected callback path and state, returns
   a small completion page to the browser, and passes the one-time code or
   normalized callback error to the frontend.
5. The frontend exchanges the code and verifier with the Server and commits the
   returned token pair through the same session path as password login.

Only one desktop OAuth attempt is active at a time. Cancellation, browser-open
failure, malformed requests, state mismatch, and a five-minute timeout clean up
the listener. The native layer never receives a provider credential or Server
access token.

## Synchronization State And Persistence

The synchronized payload is exactly `ConfigDocument`; `MachineLocalSettings`
never enters a cloud request. A local `sync-state.json` records only non-secret
metadata for the most recently synchronized account:

- account ID;
- current known Server version;
- the last successfully synchronized `ConfigDocument` baseline;
- last successful synchronization timestamp.

Keeping the validated baseline, rather than only an in-memory dirty flag, lets
the next process compare the current local document after an offline edit or a
crash. A different account never inherits the previous account's version or
baseline. Metadata writes use the same atomic file strategy as other desktop
configuration files.

The synchronization engine serializes all cloud operations. It observes local
document changes but suppresses changes caused by its own remote apply. Before
capturing a push document it explicitly flushes the configuration store's local
save queue. If the document changes during an in-flight pull or push, the
completed operation records the exact document it transferred and leaves the
newer local revision pending for a follow-up push.

Initial reconciliation is deterministic:

- no matching local baseline and Server version `0`: push the local document;
- no matching local baseline and a Server document exists: apply the Server
  document as the initial baseline;
- matching baseline and unchanged local document: pull and apply a newer
  Server version;
- matching baseline and changed local document: preserve the local document
  and push it using the known base version;
- a local edit made after login begins is treated as pending and wins only
  after the engine first learns the current Server version.

This avoids silently replacing an established cloud library merely because a
new device logged in, while still preserving intentional offline edits for an
already synchronized account.

## Scheduling And Conflict Recovery

Local changes schedule an automatic push after three quiet seconds. A
successful session startup runs immediate reconciliation, and a periodic timer
runs every 30 minutes. The account page exposes a manual sync command that uses
the same serialized path.

When a push receives `409 version_conflict`, the engine keeps the exact local
document snapshot, pulls the current Server version, and retries the same
snapshot against that version. It retries bounded concurrent conflicts rather
than looping forever. It does not apply the conflicting Server document before
the retry because ADR-0009 defines the later local writer as the whole-document
winner; the Server snapshot history preserves the displaced version.

Transient failures keep the document pending and use bounded exponential retry
delays of 5 seconds, 15 seconds, 1 minute, 5 minutes, then 30 minutes. A new
local edit or manual sync may bring the retry forward. Configuration validation,
oversize responses, invalid Server documents, and credential errors are shown
as actionable errors and are not retried in a tight loop.

The observable sync state is one of initializing, current, pending, syncing,
offline, error, or signed out. It also includes last success time, known Server
version, and a stable error code. Local saves remain independent: a cloud error
must never change the configuration store's local save status.

## Snapshots

ADR-0009 requires both the Web Console and desktop client to view and restore
snapshots. The signed-in account page therefore lists Server snapshot metadata
with version, time, source device, size, and a restore command.

Restore is explicit and confirmed. Before restoring, the engine flushes and
synchronizes any pending local document so the current state becomes a Server
snapshot. It then restores the selected snapshot using the latest known
`baseVersion`, pulls the newly advanced version, applies it through the
configuration barrier, and updates the local baseline. A concurrent restore or
push returns a visible conflict and refreshes the list; it does not silently
restore a different snapshot. The list is refreshed after successful pushes
and restores.

## Account UI

The existing mock panel is replaced in place and remains consistent with the
desktop settings design language. While signed out it provides a segmented
login/register mode, validated email/password inputs, and buttons only for
providers returned by `/auth/oauth/providers`. Disabled or unavailable
providers are not represented as successful options.

While signed in it shows the account email, this device name, sync status, last
success time, pending/error detail, manual sync, and logout. Snapshot history is
a scan-friendly table below the status controls with refresh and restore icon
commands, bounded empty/loading/error states, and confirmation before restore.
All strings use the existing `vue-i18n` Chinese and English catalogs. Buttons
prevent duplicate submissions, errors remain visible after transient failures,
and session initialization has a stable skeleton rather than briefly flashing
the login form.

## Testing And Verification

TypeScript unit tests cover:

- password login, registration followed by login, startup restoration, logout,
  refresh deduplication, retry after `401`, transient refresh preservation, and
  invalid-session cleanup;
- API success validation and stable mapping of network, HTTP, and malformed
  response failures;
- initial empty/non-empty reconciliation, clean pull, offline dirty restart,
  debounced push, edits during an in-flight operation, bounded retry, and exact
  `409` pull-and-repush behavior;
- remote apply suppression, snapshot restore ordering, and metadata account
  isolation;
- account store state transitions and browser backend behavior.

Rust unit tests cover sync metadata round-tripping/atomic replacement,
credential error mapping without logging values, loopback callback parsing,
state/path rejection, timeout/cancellation cleanup, and device identity bounds.
OS credential calls remain behind a small trait so logic tests do not mutate a
developer's real Credential Manager or Keychain.

The affected verification gates are:

```powershell
pnpm --filter @godgesture/shared test
pnpm --filter @godgesture/shared build
pnpm check:api
pnpm --filter @godgesture/desktop test
pnpm --filter @godgesture/desktop typecheck
pnpm --filter @godgesture/desktop build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets
```

Server tests are rerun only if implementation evidence requires a Server
change. Runtime acceptance uses a local configured Server for password session,
startup restoration, local edit push, remote edit pull, conflict recovery,
offline recovery, logout, and snapshot restore. Live GitHub/Google acceptance
requires deployment credentials and is recorded separately when available;
PKCE, loopback, provider discovery, and code exchange remain fully testable
without committing those credentials.

After all gates pass, `docs/PROJECT_STATUS.md` records M6 as complete, the new
desktop entry points and validation counts, and any external live-provider
acceptance boundary. M4 remains unchanged and no push is performed.
