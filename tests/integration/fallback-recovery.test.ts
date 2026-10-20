import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { createClient } from 'redis';
import { RateLimiter } from '../../src/rate-limiter.js';
import { LocalBucketStore } from '../../src/stores/local-bucket-store.js';
import { RedisBucketStore, redisBucketKey } from '../../src/stores/redis/redis-bucket-store.js';
import { serve, get } from '../helpers/http.js';

async function setup(t: TestContext, initiallyConnected: boolean) {
  // Every scenario owns its Redis key and clients; the shared Redis server is never stopped.
  const apiKey = randomUUID();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const admin = createClient({ url: redisUrl, socket: { reconnectStrategy: false } });
  admin.on('error', () => {});
  await admin.connect();
  t.after(async () => {
    try { await admin.del(redisBucketKey(apiKey)); }
    finally { admin.destroy(); }
  });

  const configuration = {
    policyFor: (key: string) => key === apiKey ? { capacity: 4, refillPerMinute: 1, requestCost: 1 as const } : undefined,
    redisTimeoutMs: 2000,
    redisProbeIntervalMs: 20,
  };
  let connected = initiallyConnected;
  let client: ReturnType<typeof createClient> | undefined;
  const redisStore = new RedisBucketStore(configuration, () => {
    // A closed local port causes a real connection refusal without disturbing other tests.
    client = createClient({
      url: connected ? redisUrl : 'redis://127.0.0.1:1',
      disableOfflineQueue: true,
      socket: { reconnectStrategy: false },
    });
    client.on('error', () => {});
    return client;
  });
  const recovery = new EventEmitter();
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume: (key) => redisStore.consume(key),
    async probe() {
      await redisStore.probe();
      recovery.emit('connected');
    },
    close: () => redisStore.close(),
  }, localStore);
  t.after(() => limiter.close());
  const server = await serve(t, { configuration, bucketStore: limiter, instanceId: 'recovery-test' });

  function disconnect(): void {
    connected = false;
    if (client?.isOpen) client.destroy();
  }

  async function reconnect(): Promise<void> {
    const recovered = once(recovery, 'connected');
    connected = true;
    await recovered;
    // Let the coordinator apply the successful probe before sending another request.
    await setImmediate();
  }

  return { server, apiKey, admin, localStore, disconnect, reconnect };
}

test('startup outage serves local limits, then recovery starts a missing Redis bucket full', { timeout: 5000 }, async (t) => {
  const { server, apiKey, admin, reconnect } = await setup(t, false);
  const headers = ['X-API-Key', apiKey];

  // During the outage, one local token is available from ceil(4 * 25%).
  const allowed = await get(server, '/api/resource', headers);
  const denied = await get(server, '/api/resource', headers);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(denied.status, 429);
  assert.equal(denied.headers['ratelimit-policy'], '"token-bucket";q=4');
  assert.equal(denied.headers['retry-after'], '60');
  assert.equal(denied.body, '{"error":{"code":"RATE_LIMIT_EXCEEDED"}}');
  assert.equal((await get(server, '/health')).status, 200);
  assert.equal(await admin.exists(redisBucketKey(apiKey)), 0);

  // Recovery probes do not create buckets; the next resource request starts Redis full.
  await reconnect();
  assert.equal(await admin.exists(redisBucketKey(apiKey)), 0);
  const recovered = await get(server, '/api/resource', headers);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers['ratelimit-policy'], '"token-bucket";q=4');
  assert.equal(recovered.headers.ratelimit, '"token-bucket";r=3');
  assert.equal(recovered.headers['retry-after'], undefined);
});

test('recovery preserves Redis balance and a later outage reuses exhausted local state', { timeout: 5000 }, async (t) => {
  const { server, apiKey, localStore, disconnect, reconnect } = await setup(t, true);
  const headers = ['X-API-Key', apiKey];
  assert.equal((await get(server, '/api/resource', headers)).headers.ratelimit, '"token-bucket";r=3');

  // Close the real store connection and force subsequent connection attempts to fail.
  disconnect();
  assert.equal((await get(server, '/api/resource', headers)).status, 200);
  assert.equal((await get(server, '/api/resource', headers)).status, 429);

  // Redis resumes its previous balance; local consumption is not merged.
  await reconnect();
  const recovered = await get(server, '/api/resource', headers);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers.ratelimit, '"token-bucket";r=2');

  disconnect();
  const repeatedOutage = await get(server, '/api/resource', headers);
  assert.equal(repeatedOutage.status, 429);
  assert.equal(repeatedOutage.headers.ratelimit, '"token-bucket";r=0');
  assert.equal(localStore.size, 1);
});
