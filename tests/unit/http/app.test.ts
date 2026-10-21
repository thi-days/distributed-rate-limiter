import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from 'express-rate-limit';
import { createApplication } from '../../../src/http/app.js';
import { get, serve } from '../../helpers/http.js';

for (const { name, headers, status, code } of [
  { name: 'missing key', headers: [], status: 400, code: 'INVALID_API_KEY' },
  {
    name: 'empty key',
    headers: ['X-API-Key', ''],
    status: 400,
    code: 'INVALID_API_KEY',
  },
  {
    name: 'whitespace in key',
    headers: ['X-API-Key', 'two words'],
    status: 400,
    code: 'INVALID_API_KEY',
  },
  {
    name: 'duplicate key fields',
    headers: ['X-API-Key', 'demo-client', 'x-API-key', 'demo-client'],
    status: 400,
    code: 'INVALID_API_KEY',
  },
  {
    name: 'unknown key',
    headers: ['X-API-Key', 'unknown'],
    status: 403,
    code: 'UNKNOWN_API_KEY',
  },
  {
    name: 'case-sensitive key',
    headers: ['X-API-Key', 'Demo-client'],
    status: 403,
    code: 'UNKNOWN_API_KEY',
  },
]) {
  test(`rejects ${name} before accessing the store`, async t => {
    const store = new MemoryStore();
    t.after(() => store.shutdown());
    const increment = t.mock.method(store, 'increment');
    const server = await serve(
      t,
      createApplication({ store, instanceId: 'test' }),
    );

    const response = await get(server, '/api/resource', headers);

    assert.equal(response.status, status);
    assert.deepEqual(JSON.parse(response.body), { error: { code } });
    assert.equal(increment.mock.callCount(), 0);
  });
}

test('health bypasses the limiter', async t => {
  const store = new MemoryStore();
  t.after(() => store.shutdown());
  const increment = t.mock.method(store, 'increment');
  const server = await serve(
    t,
    createApplication({ store, instanceId: 'test' }),
  );

  const response = await get(server, '/health', []);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-instance-id'], 'test');
  assert.equal(response.headers.ratelimit, undefined);
  assert.equal(increment.mock.callCount(), 0);
});

test('applies per-key policies and returns the library headers and denial', async t => {
  const store = new MemoryStore();
  t.after(() => store.shutdown());
  const clients = new Map([
    ['demo-client', 1],
    ['custom', 2],
  ]);
  const server = await serve(
    t,
    createApplication({ store, clients, instanceId: 'test' }),
  );

  const allowed = await get(server);
  const denied = await get(server);
  const independent = await get(server, '/api/resource', [
    'X-API-Key',
    'custom',
  ]);

  assert.equal(allowed.status, 200);
  assert.deepEqual(JSON.parse(allowed.body), { message: 'ok' });
  assert.match(String(allowed.headers.ratelimit), /r=0/);
  assert.match(String(allowed.headers['ratelimit-policy']), /q=1/);
  assert.equal(denied.status, 429);
  assert.deepEqual(JSON.parse(denied.body), {
    error: { code: 'RATE_LIMIT_EXCEEDED' },
  });
  assert.ok(Number(denied.headers['retry-after']) > 0);
  assert.equal(independent.status, 200);
  assert.match(String(independent.headers['ratelimit-policy']), /q=2/);
});

test('store errors allow requests without limiter headers and log no secret details', async t => {
  const store = new MemoryStore();
  t.after(() => store.shutdown());
  t.mock.method(store, 'increment', () => {
    throw new Error('redis://user:secret@host');
  });
  const log = t.mock.method(console, 'error', () => {});
  const server = await serve(
    t,
    createApplication({ store, instanceId: 'test' }),
  );

  const response = await get(server);

  assert.equal(response.status, 200);
  assert.equal(response.headers.ratelimit, undefined);
  assert.equal(response.headers['ratelimit-policy'], undefined);
  assert.equal(response.headers['retry-after'], undefined);
  assert.match(JSON.stringify(log.mock.calls), /allowing request/);
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /secret/);
});
