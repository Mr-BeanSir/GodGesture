# Administrator Console Management Design

## Goal

Extend the Server-owned Web Console with runtime system configuration, searchable
and paginated account management, user editing, and tabbed template moderation.
The feature must preserve the existing admin permission boundary, immutable
template review model, and the project's secret-handling rules.

## Confirmed Scope

### System configuration

Add an administrator-only `/admin/system` route. The page owns the global public
template policy and the runtime RustFS object-storage settings used by official
template packages. OAuth, SMTP, JWT, and the template-metrics HMAC secret remain
deployment environment configuration and are not exposed as editable database
settings.

RustFS endpoint, region, bucket, and signed-download TTL are persisted as plain
configuration. Access and secret keys are encrypted before persistence. The
encryption key is supplied only by the deployment environment through
`SYSTEM_CONFIG_ENCRYPTION_KEY`; it is never stored in PostgreSQL, source code,
or API responses. Existing environment values are used as bootstrap defaults
when no database configuration exists. A saved database configuration takes
precedence without requiring a process restart.

The API returns a redacted RustFS configuration. Blank key fields in an update
mean "keep the current encrypted value"; an explicit clear is not supported in
the first version because the S3 client requires credentials. The administrator
can request a RustFS connectivity check against the candidate or effective
configuration. Configuration changes write an administrator audit event.

### Account management

`GET /admin/users` becomes server-side searchable and paginated. Search is a
case-insensitive substring match against normalized email. The response keeps
the current total and adds page metadata plus display name, last login, last
use, and device count.

Add `User.lastLoginAt`. Password login and successful OAuth login update it.
`lastUseAt` is derived from the latest `Device.lastSeenAt` and is returned as
metadata; it is not a second denormalized timestamp. Token refresh and sync
continue updating device activity as they do today.

Add `/admin/users/:id/edit`. Administrators may change display name, optionally
set a new password, and edit the user's template quota overrides in the same
workflow. Email, role, account state, and session actions remain separate
because they have different confirmation and audit semantics. Setting a
password uses the existing Argon2 helper, revokes all user sessions, and writes
an audit event. No password hash or token is returned.

### Template moderation tabs

Add a business-neutral `AppTabs` component to `@godgesture/ui`. It exposes
tablist/tab semantics, active state, optional count badges, and keyboard support
for Arrow keys, Home, and End. It receives labels and content through props and
slots and has no router, store, API, or i18n dependency.

The moderation route keeps the existing three-region review surface and adds
three tabs: all templates, pending templates, and open reports. The all-template
queue is server-paginated and filterable by status; the pending queue preserves
the current review workflow; the report tab owns the open-report table and
actions. Counts are loaded from the corresponding server responses. Existing
review/report confirmations, immutable details, local error recovery, and
translated copy remain intact.

## API Contracts

The REST routes remain under `/api/v1` and use the existing Zod validation and
OpenAPI generation path.

- `GET /admin/users?email=&page=&pageSize=`
- `GET /admin/users/:id`
- `PATCH /admin/users/:id`
- `GET /admin/system-config`
- `PATCH /admin/system-config`
- `POST /admin/system-config/rustfs/test`
- Existing template-policy routes become part of the system-config response;
  compatibility endpoints remain available during this migration.
- `GET /admin/templates?status=&cursor=&limit=` supports all statuses and
  returns `nextCursor` plus a count for the current status.
- `GET /admin/templates/reports?status=` remains the report source and returns
  its current open count.

All mutating administrator routes continue to require `JwtAuthGuard` and
`AdminGuard`. Self-modification restrictions remain for role/state actions;
password and profile editing of the current administrator is allowed only for
display name, while password changes to the current administrator are rejected
to keep the existing self-protection boundary explicit.

## Data Flow And Failure Handling

System configuration updates validate hard maxima before writing. The service
updates the database transactionally, invalidates the in-process effective
RustFS configuration, and returns the redacted result. A connectivity failure
returns an actionable API error and never writes candidate values from the test
operation. RustFS object operations use the current effective configuration at
operation start; an in-flight operation is not interrupted by a later update.

User edits validate display-name and password rules, update only supplied
fields, and perform password-session revocation in the same service operation.
Unknown users return the existing `user_not_found` error. Pagination uses a
stable created-at/id ordering and clamps page size to a server maximum.

The tab UI has loading, empty, error/retry, and mutation-busy states for each
panel. Switching tabs does not discard selected moderation detail until a new
queue item is selected. A failed request leaves its panel actionable.

## Security And Compatibility

- Never return RustFS access or secret keys, password hashes, OAuth credentials,
  SMTP credentials, JWT secrets, or template-metrics HMAC values.
- `SYSTEM_CONFIG_ENCRYPTION_KEY` is required when a database-stored encrypted
  secret exists; production startup must fail clearly if it is absent.
- Existing `.env` RustFS settings remain valid as migration/bootstrap inputs;
  they are not deleted from `.env.example` until the runtime migration is
  verified and documented.
- Existing template-policy and user-policy endpoints remain compatible for
  Desktop and older Console clients.
- The API/OpenAPI artifact, `@godgesture/shared` generated types, Server, and
  Web Console are updated together.

## Validation Boundary

Run only focused tests for changed Server services/controllers, Prisma schema
contracts, `@godgesture/ui` Tabs, and affected Web Console views. Run relevant
Server/Web Console typechecks and production builds if dependencies permit.
Do not run the repository-wide `pnpm test` or other full-suite command. After
focused verification, stop and hand the running application to the maintainer
for manual testing. Full tests require a separate explicit follow-up.
