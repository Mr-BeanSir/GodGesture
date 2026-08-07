import { RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppController } from '../app.controller';
import { AdminController } from '../admin/admin.controller';
import { AuthController } from '../auth/auth.controller';
import { OAuthController } from '../auth/oauth/oauth.controller';
import { DevicesController } from '../devices/devices.controller';
import { SyncController } from '../sync/sync.controller';
import { createOpenApiDocument } from './document';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
  'trace',
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

const EXPECTED_OPERATIONS: ReadonlyArray<readonly [HttpMethod, string]> = [
  ['get', '/health'],
  ['post', '/auth/email-verification/request'],
  ['post', '/auth/password-reset/request'],
  ['post', '/auth/password-reset/confirm'],
  ['post', '/auth/register'],
  ['get', '/admin/users'],
  ['post', '/admin/users/{id}/state'],
  ['post', '/admin/users/{id}/role'],
  ['post', '/admin/users/{id}/revoke-sessions'],
  ['post', '/auth/login'],
  ['post', '/auth/refresh'],
  ['post', '/auth/logout'],
  ['get', '/auth/me'],
  ['get', '/auth/oauth/providers'],
  ['get', '/auth/oauth/{provider}/authorize'],
  ['get', '/auth/oauth/{provider}/callback'],
  ['post', '/auth/oauth/exchange'],
  ['get', '/devices'],
  ['delete', '/devices/{id}'],
  ['patch', '/devices/{id}'],
  ['get', '/sync/config'],
  ['put', '/sync/config'],
  ['get', '/sync/config/index'],
  ['get', '/sync/config/scope/{scope}'],
  ['get', '/sync/snapshots'],
  ['post', '/sync/snapshots/{version}/restore'],
];

const PROTECTED_OPERATIONS = new Set([
  'post /auth/logout',
  'get /auth/me',
  'get /admin/users',
  'post /admin/users/{id}/state',
  'post /admin/users/{id}/role',
  'post /admin/users/{id}/revoke-sessions',
  'get /devices',
  'patch /devices/{id}',
  'delete /devices/{id}',
  'get /sync/config',
  'get /sync/config/index',
  'get /sync/config/scope/{scope}',
  'put /sync/config',
  'get /sync/snapshots',
  'post /sync/snapshots/{version}/restore',
]);

const CONTROLLERS: Type[] = [
  AppController,
  AdminController,
  AuthController,
  OAuthController,
  DevicesController,
  SyncController,
];

const REQUEST_METHOD_NAMES: Partial<Record<RequestMethod, HttpMethod>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.HEAD]: 'head',
  [RequestMethod.OPTIONS]: 'options',
};

function controllerOperations(): Array<readonly [HttpMethod, string]> {
  return CONTROLLERS.flatMap((controller) => {
    const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
    return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      const handler = controller.prototype[name] as unknown;
      if (typeof handler !== 'function') return [];
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      const method =
        requestMethod == null ? undefined : REQUEST_METHOD_NAMES[requestMethod];
      const route = Reflect.getMetadata(PATH_METADATA, handler) as
        string | undefined;
      if (!method || route == null) return [];
      const path = `/${[prefix, route]
        .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/')}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      return [[method, path] as const];
    });
  });
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (typeof value !== 'object' || value === null) return refs;

  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') refs.push(child);
    else collectRefs(child, refs);
  }
  return refs;
}

describe('OpenAPI contract', () => {
  const document = createOpenApiDocument();

  function operation(method: HttpMethod, path: string) {
    const pathItem = document.paths[path];
    const result = pathItem?.[method];
    if (!result)
      throw new Error(`Missing OpenAPI operation: ${method} ${path}`);
    return result;
  }

  it('covers the complete REST surface with stable unique operation IDs', () => {
    const actual = Object.entries(document.paths).flatMap(([path, pathItem]) =>
      HTTP_METHODS.filter((method) => pathItem[method] != null).map(
        (method) => [method, path] as const,
      ),
    );

    expect(actual).toEqual(EXPECTED_OPERATIONS);
    const operationIds = actual.map(
      ([method, path]) => operation(method, path).operationId,
    );
    expect(operationIds).not.toContain(undefined);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('matches the routes exposed by the Nest controllers', () => {
    const sortKey = ([method, path]: readonly [HttpMethod, string]) =>
      `${path} ${method}`;
    const actual = controllerOperations().sort((left, right) =>
      sortKey(left).localeCompare(sortKey(right)),
    );
    const expected = [...EXPECTED_OPERATIONS].sort((left, right) =>
      sortKey(left).localeCompare(sortKey(right)),
    );

    expect(actual).toEqual(expected);
  });

  it('resolves every local component reference', () => {
    const refs = collectRefs(document);
    const schemas = document.components?.schemas ?? {};
    const securitySchemes = document.components?.securitySchemes ?? {};

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const schemaPrefix = '#/components/schemas/';
      const securityPrefix = '#/components/securitySchemes/';
      if (ref.startsWith(schemaPrefix)) {
        expect(schemas).toHaveProperty(ref.slice(schemaPrefix.length));
      } else if (ref.startsWith(securityPrefix)) {
        expect(securitySchemes).toHaveProperty(
          ref.slice(securityPrefix.length),
        );
      } else {
        throw new Error(`Unexpected OpenAPI reference: ${ref}`);
      }
    }
  });

  it('marks only authenticated operations with bearer security', () => {
    for (const [method, path] of EXPECTED_OPERATIONS) {
      const key = `${method} ${path}`;
      const security = operation(method, path).security;
      if (PROTECTED_OPERATIONS.has(key)) {
        expect(security).toEqual([{ bearerAuth: [] }]);
      } else {
        expect(security).toBeUndefined();
      }
    }
  });

  it('links representative bodies and responses to shared schemas', () => {
    const login = operation('post', '/auth/login');
    const push = operation('put', '/sync/config');

    expect(login.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/LoginRequest' },
        },
      },
    });
    expect(login.responses[200]).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/TokenPairResponse' },
        },
      },
    });
    expect(push.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PushConfigRequest' },
        },
      },
    });
    expect(push.responses[409]).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/PushConflictResponse' },
        },
      },
    });
  });

  it('documents bounded snapshot pagination query parameters', () => {
    const snapshots = operation('get', '/sync/snapshots');

    expect(snapshots.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'page',
          in: 'query',
          schema: expect.objectContaining({
            type: 'integer',
            default: 1,
            minimum: 0,
            exclusiveMinimum: true,
          }),
        }),
        expect.objectContaining({
          name: 'pageSize',
          in: 'query',
          schema: expect.objectContaining({
            type: 'integer',
            default: 10,
            minimum: 0,
            exclusiveMinimum: true,
            maximum: 50,
          }),
        }),
      ]),
    );
  });

  it('contains only the relative API server and no credential material', () => {
    expect(document.servers).toEqual([
      { url: '/api/v1', description: 'Version 1 API' },
    ]);
    const serialized = JSON.stringify(document);
    expect(serialized).not.toMatch(/OAUTH_[A-Z_]+/);
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('api.example.com');
  });
});
