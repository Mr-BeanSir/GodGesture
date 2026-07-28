# M5 OpenAPI Client Completion Design

Date: 2026-07-28

## Goal

Close the remaining M5 contract-delivery gap without expanding into M6 desktop
sync or M7 Web Console work. The existing Prisma, password/JWT, device,
OAuth, sync, snapshot, and deployment behavior remains unchanged except where
contract tests reveal a defect.

M5 is complete when:

- every current REST endpoint is represented by an OpenAPI 3 document;
- request and response schemas come from the existing `@godgesture/shared`
  Zod schemas rather than a duplicate DTO model;
- `packages/shared` exports OpenAPI-generated endpoint types and a typed fetch
  client factory;
- committed generated artifacts can be reproduced and checked for drift;
- shared and server tests/builds/typechecks pass, and the deployment contract
  remains consistent with ADR-0004.

External OAuth credentials remain deployment configuration. Their absence does
not make M5 incomplete because provider availability is already explicit at
runtime and credentials must never be committed.

## Scope

In scope:

- `apps/server`: OpenAPI document definition, document generation, contract
  tests, non-production Swagger UI integration, and deployment documentation;
- `packages/shared`: generated OpenAPI path/component types, typed fetch client
  factory, exports, and tests;
- root tooling: one deterministic API generation/check entry point;
- `docs/PROJECT_STATUS.md`: record the verified M5 completion state and updated
  validation baseline.

Out of scope:

- connecting the desktop account store or implementing synchronization loops;
- replacing the Web Console's refresh coordination and Zod response parsing;
- updater, template distribution, or macOS M4 acceptance;
- adding OAuth credentials or performing live provider login acceptance.

## Contract Architecture

`packages/shared` remains the runtime protocol source of truth. The server
registers the existing Zod request and response schemas with
`@asteasolutions/zod-to-openapi@7.3.4`, the release that supports the project's
Zod v3 dependency. Route definitions add HTTP-specific information that Zod
does not contain: method, path, parameters, status codes, security, and stable
operation IDs.

The resulting OpenAPI 3.0 document is committed as `apps/server/openapi.json`.
The server uses the same document for Swagger UI in non-production. Production
continues to expose no Swagger route, preserving ADR-0004 and the current
runtime boundary.

`openapi-typescript` generates `packages/shared/src/api/generated.ts` from the
committed document. `packages/shared/src/api/client.ts` binds those generated
`paths` to `openapi-fetch` and exports `createGodGestureApiClient`. Consumers
choose their base URL, fetch implementation, and authentication middleware;
the shared package does not own token storage or refresh rotation.

This keeps responsibilities separate:

- Zod schemas define accepted and returned data shapes;
- the server OpenAPI registry defines the HTTP surface;
- generated types prevent path, parameter, body, and response drift;
- consumer applications retain session and retry policy.

## Generation Flow

The repository-level generation command performs these steps in order:

1. build `@godgesture/shared`, so the server generator imports the current
   protocol package;
2. build the server and emit the OpenAPI document from its registry;
3. run `openapi-typescript` against `apps/server/openapi.json`;
4. rebuild shared so both ESM and CommonJS outputs include the generated client.

A check command reruns generation and fails when either committed artifact has
a Git diff. Generated files are never edited manually.

## Endpoint And Error Coverage

The document covers health, password auth, refresh/logout/me, OAuth provider
discovery/authorize/callback/exchange, device list/rename/removal, config
pull/push, snapshot list, and snapshot restore.

Authenticated endpoints declare the bearer scheme. Redirect endpoints describe
their path/query parameters and `302` response. JSON endpoints identify their
success bodies and relevant structured errors, including validation failures,
rate limiting, refresh rotation races, version conflicts, oversized
configuration documents, and missing resources. OAuth redirect endpoints
document the callback error flow, including email conflicts. Generic framework
failures may use a generic error schema; the design does not invent new runtime
error behavior solely for documentation.

## Testing

Server contract tests verify:

- the expected method/path set and unique stable operation IDs;
- every referenced component exists;
- protected routes carry bearer security while public routes do not;
- request bodies and success responses use the expected shared schemas;
- the generated document contains no accidental production server address or
  external credential.

Shared tests instantiate the typed client with a mock fetch implementation and
exercise representative public, authenticated, path-parameter, no-content, and
conflict responses. TypeScript compilation is the primary assertion that paths,
parameters, bodies, and generated response types remain valid.

The final verification scope is shared test/build/typecheck, server
test/typecheck/build, API generation drift check, and syntax/config checks for
the existing Docker/Compose deployment files. A real PostgreSQL or live OAuth
provider is not required unless these changes alter those runtime paths.

## Documentation And Completion

`README-DEPLOY.md` must state that Swagger is available only outside production,
matching the server code. `docs/PROJECT_STATUS.md` will mark M5 complete only
after the generation chain and affected validation commands pass. M4 remains
awaiting physical-Mac acceptance, and M6 remains incomplete because the desktop
account/sync implementation is still a mock.
