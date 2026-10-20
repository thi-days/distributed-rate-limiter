import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { RateLimiter } from '../../src/rate-limiter.js';
import { LocalBucketStore } from '../../src/stores/local-bucket-store.js';
import { RedisUnavailableError } from '../../src/stores/redis/redis-bucket-store.js';
import type { RateLimitDecision } from '../../src/token-bucket.js';
import { deferred } from '../helpers/deferred.js';

const policy = { capacity: 4, refillPerMinute: 60, requestCost: 1 } as const;
const configuration = {
  policyFor: (key: string) => key === 'known' ? policy : undefined,
  redisProbeIntervalMs: 1000,
};
const allowance = { allowed: true, tokens: 3, remaining: 3, retryAfterMs: 0 };
const unavailable = new RedisUnavailableError(new Error('connection lost'));

test('uses Redis when healthy and never gives a denial a local chance', async (t) => {
  const denial = { allowed: false, tokens: 0.5, remaining: 0, retryAfterMs: 500 };
  const consume = t.mock.fn(async () => denial);
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume, probe: async () => assert.fail('healthy mode must not probe'), close() {},
  }, localStore);
  t.after(() => limiter.close());

  assert.equal(await limiter.consume('known'), denial);
  assert.equal(consume.mock.callCount(), 1);
  assert.equal(localStore.size, 0);
});

test('unknown keys bypass both stores and do not start recovery', async (t) => {
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume: async () => assert.fail('unknown key reached Redis'),
    probe: async () => assert.fail('unknown key started recovery'), close() {},
  }, localStore);
  t.after(() => limiter.close());

  assert.equal(await limiter.consume('unknown'), undefined);
  assert.equal(localStore.size, 0);
});

test('a startup outage allocates one local bucket across concurrent failures', async (t) => {
  const consume = t.mock.fn(async () => { throw unavailable; });
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume, probe: async () => { throw unavailable; }, close() {},
  }, localStore);
  t.after(() => limiter.close());

  const decisions = await Promise.all(Array.from({ length: 10 }, () => limiter.consume('known')));

  assert.equal(decisions.filter((decision) => decision?.allowed).length, 1);
  assert.equal(localStore.size, 1);
  assert.equal(consume.mock.callCount(), 10);
  assert.equal((await limiter.consume('known'))?.allowed, false);
  assert.equal(consume.mock.callCount(), 10);
});

test('programming errors propagate without allocating local tokens', async (t) => {
  const error = new Error('secret configuration details');
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume: async () => { throw error; }, probe: async () => {}, close() {},
  }, localStore);
  t.after(() => limiter.close());

  await assert.rejects(limiter.consume('known'), (received) => received === error);
  assert.equal(localStore.size, 0);
});

test('recovery probes use the configured interval and never overlap', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingProbe = deferred<void>();
  const probe = t.mock.fn(() => pendingProbe.promise);
  const limiter = new RateLimiter({ ...configuration, redisProbeIntervalMs: 250 }, {
    consume: async () => { throw unavailable; }, probe, close() {},
  }, new LocalBucketStore(configuration, () => 0));
  t.after(() => limiter.close());
  await limiter.consume('known');

  t.mock.timers.tick(249);
  assert.equal(probe.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(probe.mock.callCount(), 1);
  t.mock.timers.tick(2000);
  await limiter.consume('known');
  assert.equal(probe.mock.callCount(), 1);

  pendingProbe.reject(unavailable);
  await setImmediate();
  t.mock.timers.tick(250);
  assert.equal(probe.mock.callCount(), 2);
});

test('runtime outages reuse local state after recovery without merging consumption', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let connected = true;
  const consume = t.mock.fn(async () => {
    if (!connected) throw unavailable;
    return allowance;
  });
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, { consume, probe: async () => {}, close() {} }, localStore);
  t.after(() => limiter.close());
  assert.equal(await limiter.consume('known'), allowance);
  connected = false;
  assert.equal((await limiter.consume('known'))?.allowed, true);

  connected = true;
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal(await limiter.consume('known'), allowance);
  connected = false;
  assert.equal((await limiter.consume('known'))?.allowed, false);
  assert.equal(localStore.size, 1);
});

test('an older successful probe cannot undo a newer request failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const delayedRequest = deferred<RateLimitDecision>();
  const delayedProbe = deferred<void>();
  let attempts = 0;
  const limiter = new RateLimiter(configuration, {
    consume: async () => {
      attempts++;
      if (attempts === 1) return delayedRequest.promise;
      throw unavailable;
    },
    probe: () => delayedProbe.promise, close() {},
  }, new LocalBucketStore(configuration, () => 0));
  t.after(() => limiter.close());
  const firstRequest = limiter.consume('known');
  await limiter.consume('known');
  t.mock.timers.tick(1000);

  delayedRequest.reject(unavailable);
  await firstRequest;
  delayedProbe.resolve();
  await setImmediate();
  await limiter.consume('known');

  assert.equal(attempts, 2);
});

test('non-connectivity probe errors surface instead of silently allowing local consumption', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const error = new Error('invalid Redis credentials');
  let probeError: Error | undefined = error;
  const limiter = new RateLimiter(configuration, {
    consume: async () => { throw unavailable; },
    probe: async () => { if (probeError) throw probeError; }, close() {},
  }, new LocalBucketStore(configuration, () => 0));
  t.after(() => limiter.close());
  await limiter.consume('known');

  t.mock.timers.tick(1000);
  await setImmediate();
  await assert.rejects(limiter.consume('known'), (received) => received === error);

  probeError = undefined;
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.equal((await limiter.consume('known'))?.allowed, false);
});

test('stopping recovery ignores an in-flight result and prevents new probes during draining', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendingProbe = deferred<void>();
  const probe = t.mock.fn(() => pendingProbe.promise);
  const consume = t.mock.fn(async () => { throw unavailable; });
  const close = t.mock.fn();
  const limiter = new RateLimiter(configuration, { consume, probe, close }, new LocalBucketStore(configuration, () => 0));
  await limiter.consume('known');
  t.mock.timers.tick(1000);

  limiter.stopRecovery();
  pendingProbe.resolve();
  await setImmediate();
  t.mock.timers.tick(5000);
  assert.equal((await limiter.consume('known'))?.allowed, false);
  assert.equal(consume.mock.callCount(), 1);
  assert.equal(probe.mock.callCount(), 1);
  assert.equal(close.mock.callCount(), 0);

  limiter.close();
  await assert.rejects(limiter.consume('known'), /closed/);
  assert.equal(close.mock.callCount(), 1);
});

test('closing during an uncertain attempt prevents a new local allocation', async () => {
  const pending = deferred<RateLimitDecision>();
  const localStore = new LocalBucketStore(configuration, () => 0);
  const limiter = new RateLimiter(configuration, {
    consume: () => pending.promise, probe: async () => {}, close() {},
  }, localStore);
  const request = limiter.consume('known');

  limiter.close();
  pending.reject(unavailable);

  await assert.rejects(request, /closed/);
  assert.equal(localStore.size, 0);
});
