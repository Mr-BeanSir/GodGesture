import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import {
  ConfigDocument,
  ConfigTooLargeResponse,
  AdminAccountStateRequest,
  AdminRoleRequest,
  AdminUser,
  AdminUserListResponse,
  ListDevicesResponse,
  ListSnapshotsResponse,
  LoginRequest,
  MeResponse,
  OAuthCodeChallenge,
  OAuthCodeChallengeMethod,
  OAuthExchangeRequest,
  OAuthProvider,
  OAuthProvidersResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  PullConfigResponse,
  PushConfigRequest,
  PushConfigResponse,
  PushConflictResponse,
  RateLimitedResponse,
  RefreshRequest,
  RefreshRotationRaceResponse,
  RegisterRequest,
  RequestEmailCodeRequest,
  RequestEmailCodeResponse,
  RenameDeviceRequest,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
  TokenPairResponse,
} from '@godgesture/shared';
import { z, type ZodTypeAny } from 'zod';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const configDocumentSchema = registry.register(
  'ConfigDocument',
  ConfigDocument,
);

  const schemas = {
  ConfigTooLargeResponse: registry.register(
    'ConfigTooLargeResponse',
    ConfigTooLargeResponse,
  ),
  AdminAccountStateRequest: registry.register(
    'AdminAccountStateRequest',
    AdminAccountStateRequest,
  ),
  AdminRoleRequest: registry.register('AdminRoleRequest', AdminRoleRequest),
  AdminUser: registry.register('AdminUser', AdminUser),
  AdminUserListResponse: registry.register(
    'AdminUserListResponse',
    AdminUserListResponse,
  ),
  ErrorResponse: registry.register(
    'ErrorResponse',
    z.object({
      error: z.string(),
      message: z.union([z.string(), z.array(z.string())]).optional(),
    }),
  ),
  ListDevicesResponse: registry.register(
    'ListDevicesResponse',
    ListDevicesResponse,
  ),
  ListSnapshotsResponse: registry.register(
    'ListSnapshotsResponse',
    ListSnapshotsResponse,
  ),
  LoginRequest: registry.register('LoginRequest', LoginRequest),
  MeResponse: registry.register('MeResponse', MeResponse),
  OAuthExchangeRequest: registry.register(
    'OAuthExchangeRequest',
    OAuthExchangeRequest,
  ),
  OAuthProvidersResponse: registry.register(
    'OAuthProvidersResponse',
    OAuthProvidersResponse,
  ),
  PasswordResetConfirmRequest: registry.register(
    'PasswordResetConfirmRequest',
    PasswordResetConfirmRequest,
  ),
  PasswordResetRequest: registry.register(
    'PasswordResetRequest',
    PasswordResetRequest,
  ),
  PullConfigResponse: registry.register(
    'PullConfigResponse',
    PullConfigResponse.extend({ document: configDocumentSchema.nullable() }),
  ),
  PushConfigRequest: registry.register(
    'PushConfigRequest',
    PushConfigRequest.extend({ document: configDocumentSchema }),
  ),
  PushConfigResponse: registry.register(
    'PushConfigResponse',
    PushConfigResponse,
  ),
  PushConflictResponse: registry.register(
    'PushConflictResponse',
    PushConflictResponse,
  ),
  RateLimitedResponse: registry.register(
    'RateLimitedResponse',
    RateLimitedResponse,
  ),
  RefreshRequest: registry.register('RefreshRequest', RefreshRequest),
  RefreshRotationRaceResponse: registry.register(
    'RefreshRotationRaceResponse',
    RefreshRotationRaceResponse,
  ),
  RegisterRequest: registry.register('RegisterRequest', RegisterRequest),
  RequestEmailCodeRequest: registry.register(
    'RequestEmailCodeRequest',
    RequestEmailCodeRequest,
  ),
  RequestEmailCodeResponse: registry.register(
    'RequestEmailCodeResponse',
    RequestEmailCodeResponse,
  ),
  RenameDeviceRequest: registry.register(
    'RenameDeviceRequest',
    RenameDeviceRequest,
  ),
  RestoreSnapshotRequest: registry.register(
    'RestoreSnapshotRequest',
    RestoreSnapshotRequest,
  ),
  RestoreSnapshotResponse: registry.register(
    'RestoreSnapshotResponse',
    RestoreSnapshotResponse,
  ),
  TokenPairResponse: registry.register('TokenPairResponse', TokenPairResponse),
  ValidationErrorResponse: registry.register(
    'ValidationErrorResponse',
    z.object({
      error: z.literal('validation_failed'),
      issues: z.array(
        z.object({
          path: z.string(),
          message: z.string(),
        }),
      ),
    }),
  ),
};

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const bearerSecurity = [{ bearerAuth: [] }];
const providerParams = z.object({ provider: OAuthProvider });
const deviceParams = z.object({ id: z.string().uuid() });
const userParams = z.object({ id: z.string().uuid() });
const snapshotParams = z.object({
  version: z.coerce.number().int().positive(),
});

function jsonContent(schema: ZodTypeAny) {
  return { 'application/json': { schema } };
}

function jsonResponse(description: string, schema: ZodTypeAny) {
  return { description, content: jsonContent(schema) };
}

const validationError = jsonResponse(
  'Request validation failed.',
  schemas.ValidationErrorResponse,
);
const genericError = jsonResponse('Request failed.', schemas.ErrorResponse);
const rateLimited = jsonResponse(
  'The request rate limit was exceeded.',
  schemas.RateLimitedResponse,
);

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['meta'],
  operationId: 'getHealth',
  summary: 'Service health check',
  responses: {
    200: jsonResponse(
      'The service is healthy.',
      z.object({ status: z.literal('ok') }),
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/email-verification/request',
  tags: ['auth'],
  operationId: 'requestRegistrationEmailCode',
  summary: 'Send a registration email verification code',
  request: {
    body: {
      required: true,
      content: jsonContent(schemas.RequestEmailCodeRequest),
    },
  },
  responses: {
    200: jsonResponse('The request was accepted.', schemas.RequestEmailCodeResponse),
    400: validationError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/password-reset/request',
  tags: ['auth'],
  operationId: 'requestPasswordReset',
  summary: 'Request a password reset code without revealing account existence',
  request: {
    body: {
      required: true,
      content: jsonContent(schemas.PasswordResetRequest),
    },
  },
  responses: {
    200: jsonResponse('The request was accepted.', schemas.RequestEmailCodeResponse),
    400: validationError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/password-reset/confirm',
  tags: ['auth'],
  operationId: 'confirmPasswordReset',
  summary: 'Set a new password with a one-time email code',
  request: {
    body: {
      required: true,
      content: jsonContent(schemas.PasswordResetConfirmRequest),
    },
  },
  responses: {
    204: { description: 'The password was changed and sessions revoked.' },
    400: validationError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['auth'],
  operationId: 'registerAccount',
  summary: 'Register an account with email and password',
  request: {
    body: { required: true, content: jsonContent(schemas.RegisterRequest) },
  },
  responses: {
    201: jsonResponse('The account was created.', schemas.MeResponse),
    400: validationError,
    409: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/users',
  tags: ['admin'],
  operationId: 'listAdminUsers',
  summary: 'List account metadata for administrators',
  security: bearerSecurity,
  responses: {
    200: jsonResponse('The account metadata list.', schemas.AdminUserListResponse),
    401: genericError,
    403: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/users/{id}/state',
  tags: ['admin'],
  operationId: 'setAdminUserState',
  summary: 'Enable or disable a user account',
  security: bearerSecurity,
  request: {
    params: userParams,
    body: {
      required: true,
      content: jsonContent(schemas.AdminAccountStateRequest),
    },
  },
  responses: {
    204: { description: 'The account state was updated.' },
    400: validationError,
    401: genericError,
    403: genericError,
    404: genericError,
    409: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/users/{id}/role',
  tags: ['admin'],
  operationId: 'setAdminUserRole',
  summary: 'Change a user role',
  security: bearerSecurity,
  request: {
    params: userParams,
    body: { required: true, content: jsonContent(schemas.AdminRoleRequest) },
  },
  responses: {
    204: { description: 'The account role was updated.' },
    400: validationError,
    401: genericError,
    403: genericError,
    404: genericError,
    409: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/users/{id}/revoke-sessions',
  tags: ['admin'],
  operationId: 'revokeAdminUserSessions',
  summary: 'Revoke all sessions for a user',
  security: bearerSecurity,
  request: { params: userParams },
  responses: {
    204: { description: 'The user sessions were revoked.' },
    401: genericError,
    403: genericError,
    404: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  operationId: 'login',
  summary: 'Log in and register a device',
  request: {
    body: { required: true, content: jsonContent(schemas.LoginRequest) },
  },
  responses: {
    200: jsonResponse('A token pair was issued.', schemas.TokenPairResponse),
    400: validationError,
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['auth'],
  operationId: 'refreshTokenPair',
  summary: 'Rotate a refresh token and issue a new token pair',
  request: {
    body: { required: true, content: jsonContent(schemas.RefreshRequest) },
  },
  responses: {
    200: jsonResponse(
      'A replacement token pair was issued.',
      schemas.TokenPairResponse,
    ),
    400: validationError,
    401: genericError,
    409: jsonResponse(
      'Another request already rotated this refresh token.',
      schemas.RefreshRotationRaceResponse,
    ),
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  operationId: 'logout',
  summary: 'Revoke refresh tokens for the current device',
  security: bearerSecurity,
  responses: {
    204: { description: 'The current device was logged out.' },
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['auth'],
  operationId: 'getCurrentAccount',
  summary: 'Get the current account',
  security: bearerSecurity,
  responses: {
    200: jsonResponse('The current account.', schemas.MeResponse),
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/oauth/providers',
  tags: ['auth', 'oauth'],
  operationId: 'listOAuthProviders',
  summary: 'List enabled OAuth providers',
  responses: {
    200: jsonResponse(
      'The enabled provider list.',
      schemas.OAuthProvidersResponse,
    ),
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/oauth/{provider}/authorize',
  tags: ['auth', 'oauth'],
  operationId: 'authorizeOAuth',
  summary: 'Redirect to an OAuth provider authorization page',
  request: {
    params: providerParams,
    query: z.object({
      redirect_uri: z.string().url(),
      state: z.string().optional(),
      code_challenge: OAuthCodeChallenge,
      code_challenge_method: OAuthCodeChallengeMethod,
    }),
  },
  responses: {
    302: {
      description: 'Redirect to the provider authorization page.',
      headers: z.object({ location: z.string().url() }),
    },
    400: genericError,
    404: genericError,
    429: rateLimited,
    501: genericError,
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/oauth/{provider}/callback',
  tags: ['auth', 'oauth'],
  operationId: 'handleOAuthCallback',
  summary: 'Handle a provider callback and redirect to the client',
  request: {
    params: providerParams,
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  responses: {
    302: {
      description: 'Redirect to the validated client callback URI.',
      headers: z.object({ location: z.string().url() }),
    },
    400: genericError,
    404: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/oauth/exchange',
  tags: ['auth', 'oauth'],
  operationId: 'exchangeOAuthCode',
  summary: 'Exchange a one-time OAuth code for a token pair',
  request: {
    body: {
      required: true,
      content: jsonContent(schemas.OAuthExchangeRequest),
    },
  },
  responses: {
    200: jsonResponse('A token pair was issued.', schemas.TokenPairResponse),
    400: validationError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/devices',
  tags: ['devices'],
  operationId: 'listDevices',
  summary: 'List account devices',
  security: bearerSecurity,
  responses: {
    200: jsonResponse('The account device list.', schemas.ListDevicesResponse),
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/devices/{id}',
  tags: ['devices'],
  operationId: 'renameDevice',
  summary: 'Rename an account device',
  security: bearerSecurity,
  request: {
    params: deviceParams,
    body: {
      required: true,
      content: jsonContent(schemas.RenameDeviceRequest),
    },
  },
  responses: {
    204: { description: 'The device was renamed.' },
    400: validationError,
    401: genericError,
    404: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/devices/{id}',
  tags: ['devices'],
  operationId: 'removeDevice',
  summary: 'Remove a device and revoke its access',
  security: bearerSecurity,
  request: { params: deviceParams },
  responses: {
    204: { description: 'The device was removed.' },
    400: genericError,
    401: genericError,
    404: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/sync/config',
  tags: ['sync'],
  operationId: 'pullConfig',
  summary: 'Pull the current configuration document',
  security: bearerSecurity,
  responses: {
    200: jsonResponse(
      'The current configuration state.',
      schemas.PullConfigResponse,
    ),
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'put',
  path: '/sync/config',
  tags: ['sync'],
  operationId: 'pushConfig',
  summary: 'Push a configuration document with version CAS',
  security: bearerSecurity,
  request: {
    body: { required: true, content: jsonContent(schemas.PushConfigRequest) },
  },
  responses: {
    200: jsonResponse(
      'The new configuration version.',
      schemas.PushConfigResponse,
    ),
    400: validationError,
    401: genericError,
    409: jsonResponse(
      'The base version is stale.',
      schemas.PushConflictResponse,
    ),
    413: jsonResponse(
      'The configuration document exceeds the protocol limit.',
      schemas.ConfigTooLargeResponse,
    ),
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'get',
  path: '/sync/snapshots',
  tags: ['sync'],
  operationId: 'listSnapshots',
  summary: 'List retained configuration snapshots',
  security: bearerSecurity,
  responses: {
    200: jsonResponse(
      'The retained snapshot list.',
      schemas.ListSnapshotsResponse,
    ),
    401: genericError,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/sync/snapshots/{version}/restore',
  tags: ['sync'],
  operationId: 'restoreSnapshot',
  summary: 'Restore a snapshot as a new configuration version',
  security: bearerSecurity,
  request: {
    params: snapshotParams,
    body: {
      required: true,
      content: jsonContent(schemas.RestoreSnapshotRequest),
    },
  },
  responses: {
    200: jsonResponse(
      'The new configuration version.',
      schemas.RestoreSnapshotResponse,
    ),
    400: validationError,
    401: genericError,
    404: genericError,
    409: jsonResponse(
      'The base version is stale.',
      schemas.PushConflictResponse,
    ),
    429: rateLimited,
  },
});

export function createOpenApiDocument(): ReturnType<
  OpenApiGeneratorV3['generateDocument']
> {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'GodGesture API',
      version: '0.1.0',
      description:
        'GodGesture account and synchronization API. Data schemas are generated from @godgesture/shared Zod protocols.',
    },
    servers: [{ url: '/api/v1', description: 'Version 1 API' }],
    tags: [
      { name: 'meta', description: 'Service metadata' },
      { name: 'auth', description: 'Account and token operations' },
      { name: 'oauth', description: 'OAuth authorization code flow' },
      { name: 'devices', description: 'Account device management' },
      { name: 'sync', description: 'Configuration synchronization' },
    ],
  });
}
