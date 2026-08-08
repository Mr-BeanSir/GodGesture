import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('server compose keeps RustFS private, durable, and healthy', () => {
  const compose = read('apps/server/docker-compose.prod.yml');
  assert.match(compose, /rustfs:\s*\n\s*image:\s*rustfs\/rustfs/);
  assert.match(compose, /rustfsdata:\/data/);
  assert.match(compose, /rustfsdata:/);
  assert.match(compose, /curl -fsS http:\/\/localhost:9000\/health/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:.*9000/);
  assert.match(compose, /RUSTFS_ENDPOINT:\s*http:\/\/rustfs:9000/);
});

test('RustFS credentials and TTL are documented as deployment configuration', () => {
  const env = read('apps/server/.env.example');
  for (const key of ['RUSTFS_ENDPOINT', 'RUSTFS_REGION', 'RUSTFS_BUCKET', 'RUSTFS_ACCESS_KEY', 'RUSTFS_SECRET_KEY', 'RUSTFS_PUBLIC_DOWNLOAD_TTL_SEC']) {
    assert.match(env, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(env, /^RUSTFS_PUBLIC_DOWNLOAD_TTL_SEC=300$/m);
  assert.match(read('apps/server/README-DEPLOY.md'), /同一维护窗口备份/);
});
