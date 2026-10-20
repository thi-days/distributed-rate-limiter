import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createClient } from 'redis';
import { RedisBucketStore, RedisUnavailableError, redisBucketKey } from '../../src/stores/redis/redis-bucket-store.js';
import { bucketReferences } from '../helpers/bucket-reference.js';
import { consumeToken, initialBucket } from '../../src/token-bucket.js';

test('real Redis atomic bucket, fractional state, reference cases, expiry, and lifecycle', { timeout: 15_000 }, async () => {
  const admin = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', socket: { reconnectStrategy: false } });
  admin.on('error', () => {});
  await admin.connect();
  const keys: string[] = [];
  const stores: RedisBucketStore[] = [];
  try {
    for (const reference of bucketReferences) {
      const key = randomUUID();
      const bucketKey = redisBucketKey(key);
      keys.push(bucketKey);
      const store = new RedisBucketStore({ policyFor: () => reference.policy, redisTimeoutMs: 2000 });
      stores.push(store);
      // Seed reference preconditions through the admin connection, never a production clock.
      let previous = initialBucket(reference.policy, 0, 'local');
      for (const step of reference.steps) {
        const elapsed = step.atMs - previous.lastRefillMs;
        await admin.eval(`local t=redis.call('TIME'); redis.call('HSET', KEYS[1], 'tokens', ARGV[1], 'last_refill', t[1]*1000+t[2]/1000-ARGV[2]); return 1`, {
          keys: [bucketKey], arguments: [String(previous.tokens), String(elapsed)],
        });
        for (let call = 0; call < step.calls; call++) {
          const expected = consumeToken(reference.policy, previous, step.atMs);
          const result = await store.consume(key);
          assert.equal(result?.allowed, expected.decision.allowed);
          assert.ok(Math.abs(result!.tokens - expected.decision.tokens) < 0.1);
          assert.equal(result!.remaining, Math.floor(result!.tokens));
          previous = expected.state;
        }
      }
    }
    const key = randomUUID();
    const otherKey = randomUUID();
    keys.push(redisBucketKey(key), redisBucketKey(otherKey));
    const policy = { capacity: 10, refillPerMinute: 1, requestCost: 1 } as const;
    const connection = admin.duplicate({ socket: { reconnectStrategy: false }, disableOfflineQueue: true });
    connection.on('error', () => {});
    const store = new RedisBucketStore({ policyFor: () => policy, redisTimeoutMs: 2000 }, () => {
      const client = connection.isOpen ? admin.duplicate({ socket: { reconnectStrategy: false }, disableOfflineQueue: true }) : connection;
      client.on('error', () => {});
      return client;
    });
    stores.push(store);
    const results = await Promise.all(Array.from({ length: 50 }, () => store.consume(key)));
    assert.equal(results.filter((result) => result?.allowed).length, 10);
    assert.equal((await store.consume(otherKey))?.allowed, true);
    const denial = await store.consume(key);
    assert.equal(denial?.allowed, false);
    const state = await admin.hGetAll(redisBucketKey(key));
    assert.equal(Number(state.tokens), denial?.tokens);
    const ttl = await admin.pTTL(redisBucketKey(key));
    assert.ok(ttl > 599_000 && ttl <= 600_000);

    // Kill the actual store connection, observe failure, then establish a fresh one.
    const clientId = await connection.clientId();
    await admin.clientKill({ filter: 'ID', id: clientId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(store.consume(key), RedisUnavailableError);
    assert.equal((await store.consume(otherKey))?.allowed, true);

    const expiringKey = randomUUID();
    keys.push(redisBucketKey(expiringKey));
    const expiring = new RedisBucketStore({ policyFor: () => ({ capacity: 1, refillPerMinute: 600, requestCost: 1 }), redisTimeoutMs: 2000 });
    stores.push(expiring);
    await expiring.consume(expiringKey);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await admin.exists(redisBucketKey(expiringKey)), 0);
    assert.equal((await expiring.consume(expiringKey))?.allowed, true);
    expiring.close();
    await assert.rejects(expiring.consume(expiringKey), /closed/);
  } finally {
    for (const store of stores) store.close();
    await admin.del(keys);
    admin.destroy();
  }
});
