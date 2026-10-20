import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import type { Configuration, Policy } from '../../../src/config.js';
import { RateLimiter } from '../../../src/rate-limiter.js';
import { LocalBucketStore } from '../../../src/stores/local-bucket-store.js';
import { RedisBucketStore, RedisUnavailableError } from '../../../src/stores/redis/redis-bucket-store.js';
import { deferred } from '../../helpers/deferred.js';
import { serve, get } from '../../helpers/http.js';

const policies = new Map<string, Policy>([
  ['known', { capacity: 4, refillPerMinute: 60, requestCost: 1 }],
  ['custom', { capacity: 8, refillPerMinute: 1, requestCost: 1 }],
]);
const configuration: Configuration = {
  policyFor: (key) => policies.get(key),
  redisTimeoutMs: 10,
  redisProbeIntervalMs: 1000,
};
const unavailable = new RedisUnavailableError(new Error('connection lost'));

async function serveFallback(
  t: TestContext,
  redisStore: Pick<RedisBucketStore, 'consume' | 'probe' | 'close'>,
  nowMs: () => number,
) {
  const localStore = new LocalBucketStore(configuration, nowMs);
  const limiter = new RateLimiter(configuration, redisStore, localStore);
  const handler = t.mock.fn();
  const server = await serve(t, {
    configuration,
    bucketStore: limiter,
    instanceId: 'fallback-test',
    resourceHandler(_req, res) {
      handler();
      res.json({ message: 'ok' });
    },
  });
  t.after(() => limiter.close());
  return { server, localStore, handler };
}

const disconnectedRedis = {
  consume: async () => { throw unavailable; },
  probe: async () => { throw unavailable; },
  close() {},
};

test('fallback sends the same allowance and denial headers without invoking a denied handler', async (t) => {
  const { server, handler } = await serveFallback(t, disconnectedRedis, () => 0);

  const allowed = await get(server);
  const denied = await get(server);

  assert.equal(allowed.status, 200);
  assert.equal(allowed.body, '{"message":"ok"}');
  assert.equal(allowed.headers['ratelimit-policy'], '"token-bucket";q=4');
  assert.equal(allowed.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(allowed.headers['retry-after'], undefined);
  assert.equal(denied.status, 429);
  assert.equal(denied.body, '{"error":{"code":"RATE_LIMIT_EXCEEDED"}}');
  assert.equal(denied.headers['ratelimit-policy'], '"token-bucket";q=4');
  assert.equal(denied.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(denied.headers['retry-after'], '1');
  assert.equal(handler.mock.callCount(), 1);
});

test('fallback isolates keys and honors policy overrides', async (t) => {
  const { server, handler } = await serveFallback(t, disconnectedRedis, () => 0);
  await get(server);
  assert.equal((await get(server)).status, 429);

  const response = await get(server, '/api/resource', ['X-API-Key', 'custom']);

  assert.equal(response.status, 200);
  assert.equal(response.headers['ratelimit-policy'], '"token-bucket";q=8');
  assert.equal(response.headers.ratelimit, '"token-bucket";r=1');
  assert.equal(handler.mock.callCount(), 2);
});

test('fallback preserves fractional refill and rounds retry delay up', async (t) => {
  let nowMs = 0;
  const { server, handler } = await serveFallback(t, disconnectedRedis, () => nowMs);
  await get(server);

  nowMs = 500;
  const denied = await get(server);
  nowMs = 1000;
  const refilled = await get(server);

  assert.equal(denied.status, 429);
  assert.equal(denied.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(denied.headers['retry-after'], '1');
  assert.equal(refilled.status, 200);
  assert.equal(refilled.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(handler.mock.callCount(), 2);
});

test('invalid keys, unknown keys, and health do not allocate or consume local tokens', async (t) => {
  const consume = t.mock.fn(disconnectedRedis.consume);
  const { server, localStore } = await serveFallback(t, { ...disconnectedRedis, consume }, () => 0);
  await get(server);
  assert.equal(localStore.size, 1);

  assert.equal((await get(server, '/api/resource', [])).status, 400);
  assert.equal((await get(server, '/api/resource', ['X-API-Key', 'bad key'])).status, 400);
  assert.equal((await get(server, '/api/resource', ['X-API-Key', 'unknown'])).status, 403);
  assert.equal((await get(server, '/health')).status, 200);

  assert.equal(consume.mock.callCount(), 1);
  assert.equal(localStore.size, 1);
  assert.equal((await get(server, '/api/resource', ['X-API-Key', 'custom'])).headers.ratelimit, '"token-bucket";r=1');
});

test('non-connectivity errors return redacted JSON instead of selecting fallback', async (t) => {
  const { server, localStore, handler } = await serveFallback(t, {
    ...disconnectedRedis,
    consume: async () => { throw new Error('secret Redis credentials'); },
  }, () => 0);

  const response = await get(server);

  assert.equal(response.status, 500);
  assert.equal(response.body, '{"error":{"code":"INTERNAL_ERROR"}}');
  assert.equal(response.headers.ratelimit, undefined);
  assert.equal(localStore.size, 0);
  assert.equal(handler.mock.callCount(), 0);
});

test('a late Redis reply does not retry consumption or send another HTTP response', async (t) => {
  const pendingReply = deferred<unknown>();
  const execute = t.mock.fn(() => pendingReply.promise);
  const redisStore = new RedisBucketStore(configuration, () => ({
    isOpen: true,
    connect: async () => {},
    eval: execute,
    destroy() {},
  }));
  const { server, handler } = await serveFallback(t, redisStore, () => 0);

  // The real adapter times out the uncertain write; HTTP completes from one local decision.
  const response = await get(server);
  pendingReply.resolve([1, '3']);
  await setImmediate();

  assert.equal(response.status, 200);
  assert.equal(response.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(handler.mock.callCount(), 1);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal((await get(server)).status, 429);
  assert.equal(handler.mock.callCount(), 1);
});


test('a slow-refill override rounds fractional seconds up on fallback denial', async (t) => {
  let nowMs = 0;
  const { server } = await serveFallback(t, disconnectedRedis, () => nowMs);
  const headers = ['X-API-Key', 'custom'];

  // Spend the two initial local tokens, then earn only a fractional token.
  await get(server, '/api/resource', headers);
  await get(server, '/api/resource', headers);
  nowMs = 500;
  const denied = await get(server, '/api/resource', headers);

  assert.equal(denied.status, 429);
  assert.equal(denied.headers['retry-after'], '60');
  assert.equal(denied.headers.ratelimit, '"token-bucket";r=0');
});
