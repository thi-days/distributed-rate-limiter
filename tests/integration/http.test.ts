import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import type { Policy } from '../../src/config.js';
import { createClient } from 'redis';
import { RedisBucketStore, redisBucketKey } from '../../src/stores/redis/redis-bucket-store.js';
import { get, serve } from '../helpers/http.js';

async function setupRedisHttp(t: TestContext) {
  const admin = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', socket: { reconnectStrategy: false } });
  admin.on('error', () => {});
  await admin.connect();
  const key = randomUUID();
  const other = randomUUID();
  const policies = new Map<string, Policy>([
    [key, { capacity: 1, refillPerMinute: 1, requestCost: 1 as const }],
    [other, { capacity: 3, refillPerMinute: 60, requestCost: 1 as const }],
  ]);
  const configuration = {
    redisTimeoutMs: 2000,
    policyFor: (apiKey: string) => policies.get(apiKey),
  };
  const store = new RedisBucketStore(configuration);
  const calls = { handled: 0, attempts: 0 };
  const server = await serve(t, {
    configuration,
    instanceId: 'redis-test',
    bucketStore: {
      consume(apiKey) {
        calls.attempts++;
        return store.consume(apiKey);
      },
    },
    resourceHandler: (_req, res) => { calls.handled++; res.json({ message: 'ok' }); },
  });
  t.after(async () => {
    store.close();
    try {
      await admin.del([redisBucketKey(key), redisBucketKey(other)]);
    } finally {
      admin.destroy();
    }
  });
  return { admin, key, other, server, store, calls };
}

test('invalid keys and health do not consume tokens', async (t) => {
  const { admin, key, server, calls } = await setupRedisHttp(t);

  assert.equal((await get(server, '/health')).status, 200);
  assert.equal((await get(server, '/api/resource', [])).status, 400);
  assert.equal((await get(server)).status, 403);
  assert.equal(calls.attempts, 0);
  assert.equal(await admin.exists(redisBucketKey(key)), 0);
});

test('allows the first request and reports remaining tokens', async (t) => {
  const { key, server } = await setupRedisHttp(t);

  const allowed = await get(server, '/api/resource', ['X-API-Key', key]);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['ratelimit-policy'], '"token-bucket";q=1');
  assert.equal(allowed.headers.ratelimit, '"token-bucket";r=0');
});

test('denies the exhausted bucket with exact headers and retry rounding', async (t) => {
  const { admin, key, server } = await setupRedisHttp(t);

  await get(server, '/api/resource', ['X-API-Key', key]);

  const denied = await get(server, '/api/resource', ['X-API-Key', key]);
  assert.equal(denied.status, 429);
  assert.equal(denied.body, '{"error":{"code":"RATE_LIMIT_EXCEEDED"}}');
  assert.equal(denied.headers['ratelimit-policy'], '"token-bucket";q=1');
  assert.equal(denied.headers.ratelimit, '"token-bucket";r=0');
  const tokens = Number(await admin.hGet(redisBucketKey(key), 'tokens'));
  assert.equal(denied.headers['retry-after'], String(Math.max(1, Math.ceil((1 - tokens) * 60))));
});

test('isolates keys and applies policy overrides', async (t) => {
  const { other, server } = await setupRedisHttp(t);

  const independent = await get(server, '/api/resource', ['X-API-Key', other]);
  assert.equal(independent.status, 200);
  assert.equal(independent.headers['ratelimit-policy'], '"token-bucket";q=3');
  assert.equal(independent.headers.ratelimit, '"token-bucket";r=2');
});

test('allows another request after refill', async (t) => {
  const { admin, key, server, calls } = await setupRedisHttp(t);

  await get(server, '/api/resource', ['X-API-Key', key]);

  // Age persisted state with Redis TIME so refill is deterministic without a production clock hook.
  await admin.eval("local t=redis.call('TIME'); redis.call('HSET', KEYS[1], 'last_refill', t[1]*1000+t[2]/1000-60000); return 1", { keys: [redisBucketKey(key)], arguments: [] });
  assert.equal((await get(server, '/api/resource', ['X-API-Key', key])).status, 200);
  assert.equal(calls.handled, 2);
  assert.equal(calls.attempts, 2);
});

test('health stays available when the store is closed', async (t) => {
  const { key, server, store } = await setupRedisHttp(t);

  store.close();
  assert.equal((await get(server, '/health')).status, 200);
  assert.equal((await get(server, '/api/resource', ['X-API-Key', key])).body, '{"error":{"code":"INTERNAL_ERROR"}}');
});

