import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimpleError } from 'redis';
import { RedisBucketStore, RedisUnavailableError, type BucketConnection } from '../../../../src/stores/redis/redis-bucket-store.js';

const policy = { capacity: 10, refillPerMinute: 60, requestCost: 1 } as const;
const configuration = { policyFor: (key: string) => key === 'known' ? policy : undefined };

function fake(overrides: Partial<BucketConnection> = {}): BucketConnection {
  return { isOpen: true, connect: async () => {}, eval: async () => [1, '9'], destroy: () => {}, ...overrides };
}

test('reuse connection, ignore unknown keys, and shut down', async () => {
  let connections = 0;
  let destroys = 0;
  const store = new RedisBucketStore(configuration, () => {
    connections++;
    return fake({ destroy: () => { destroys++; } });
  });
  assert.equal(await store.consume('unknown'), undefined);
  assert.equal(connections, 0);
  await store.consume('known');
  await store.consume('known');
  assert.equal(connections, 1);
  store.close();
  store.close();
  assert.equal(destroys, 1);
  await assert.rejects(store.consume('known'), /closed/);
});

test('default deadline includes connection waiting and prevents delayed submission', async () => {
  let finishConnect: (() => void) | undefined;
  let calls = 0;
  let destroys = 0;
  const store = new RedisBucketStore(configuration, () => fake({
    connect: () => new Promise<void>((resolve) => { finishConnect = resolve; }),
    eval: async () => { calls++; return [1, '9']; },
    destroy: () => { destroys++; },
  }));
  await assert.rejects(store.consume('known'), RedisUnavailableError);
  finishConnect?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.equal(destroys, 1);
  store.close();
});

test('uncertain consumption times out once and is never retried; next attempt can reconnect', async () => {
  let calls = 0;
  let connections = 0;
  const store = new RedisBucketStore({ ...configuration, redisTimeoutMs: 5 }, () => {
    connections++;
    return fake({ eval: async () => { calls++; return connections === 1 ? new Promise(() => {}) : [1, '9']; } });
  });
  await assert.rejects(store.consume('known'), RedisUnavailableError);
  assert.equal(calls, 1);
  assert.equal((await store.consume('known'))?.allowed, true);
  assert.equal(connections, 2);
  store.close();
});

test('only connectivity errors qualify for fallback; denial remains a decision', async () => {
  for (const error of [Object.assign(new Error(), { code: 'ECONNRESET' }),
    new SimpleError('WRONGPASS invalid credentials'), new SimpleError('ERR script failure'), new Error('configuration')]) {
    let calls = 0;
    const store = new RedisBucketStore(configuration, () => fake({ eval: async () => { calls++; throw error; } }));
    await assert.rejects(store.consume('known'), (actual: unknown) =>
      'code' in error ? actual instanceof RedisUnavailableError : actual === error);
    assert.equal(calls, 1);
    store.close();
  }
  const store = new RedisBucketStore(configuration, () => fake({ eval: async () => [0, '0.5'] }));
  assert.equal((await store.consume('known'))?.allowed, false);
  store.close();
});

test('probe reuses the connection without addressing or consuming a bucket', async () => {
  let connections = 0;
  const commands: { script: string; keys: string[] }[] = [];
  const store = new RedisBucketStore(configuration, () => {
    connections++;
    return fake({
      eval: async (script, options) => {
        commands.push({ script, keys: options.keys });
        return script === 'return 1' ? 1 : [1, '9'];
      },
    });
  });

  try {
    await store.probe();
    await store.consume('known');
    await store.probe();

    assert.equal(connections, 1);
    assert.deepEqual(commands[0], { script: 'return 1', keys: [] });
    assert.deepEqual(commands[2], { script: 'return 1', keys: [] });
  } finally {
    store.close();
  }
});

test('probe timeout includes connecting and prevents delayed submission', async () => {
  const connection = new Promise<void>(() => {});
  let calls = 0;
  const store = new RedisBucketStore({ ...configuration, redisTimeoutMs: 5 }, () => fake({
    connect: () => connection,
    eval: async () => { calls++; return 1; },
  }));

  try {
    await assert.rejects(store.probe(), RedisUnavailableError);
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});

test('probe rejects command failures and malformed replies without classifying them as outages', async () => {
  for (const reply of [new SimpleError('WRONGPASS secret'), 'unexpected']) {
    const store = new RedisBucketStore(configuration, () => fake({
      eval: async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      },
    }));

    try {
      await assert.rejects(store.probe(), (error: unknown) => error instanceof Error && !(error instanceof RedisUnavailableError));
    } finally {
      store.close();
    }
  }
});
