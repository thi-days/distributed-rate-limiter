import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Policy } from '../../src/config.js';
import { LocalBucketStore } from '../../src/local-bucket-store.js';
import { bucketReferences } from '../helpers/bucket-reference.js';

const policy: Policy = { capacity: 10, refillPerMinute: 60, requestCost: 1 };
const configuration = { policyFor: (apiKey: string) => ['a', 'b'].includes(apiKey) ? policy : undefined };

for (const reference of bucketReferences) {
  test(`local reference: ${reference.name}`, () => {
    let nowMs = 0;
    const store = new LocalBucketStore({ policyFor: () => reference.policy }, () => nowMs);

    for (const step of reference.steps) {
      nowMs = step.atMs;

      for (let requestIndex = 0; requestIndex < step.calls; requestIndex++) {
        const decision = store.consume('registered');
        assert.equal(decision?.allowed, step.allowed);

        if (requestIndex === step.calls - 1) {
          assert.deepEqual(decision, {
            allowed: step.allowed, tokens: step.tokens,
            remaining: Math.floor(step.tokens), retryAfterMs: step.retryAfterMs,
          });
        }
      }
    }

    assert.equal(store.size, 1);
  });
}

test('keys are independent; unknown keys allocate nothing and never read the clock', () => {
  let clockCalls = 0;
  const store = new LocalBucketStore(configuration, () => { clockCalls++; return 0; });

  for (let keyIndex = 0; keyIndex < 100; keyIndex++) {
    assert.equal(store.consume(`unknown-${keyIndex}`), undefined);
  }

  assert.equal(store.size, 0);
  assert.equal(clockCalls, 0);

  for (let requestIndex = 0; requestIndex < 3; requestIndex++) assert.equal(store.consume('a')?.allowed, true);

  assert.equal(store.consume('a')?.allowed, false);
  assert.equal(store.consume('b')?.tokens, 2);
  assert.equal(store.size, 2);
});

test('concurrent callers spend the last token only once', async () => {
  const store = new LocalBucketStore(configuration, () => 0);
  store.consume('a');
  store.consume('a');

  const decisions = await Promise.all(Array.from({ length: 50 }, async () => store.consume('a')));
  assert.equal(decisions.filter((decision) => decision?.allowed).length, 1);
  assert.equal(store.consume('a')?.tokens, 0);
});

test('reuse across outages retains state and includes healthy elapsed time; restart initializes anew', () => {
  let nowMs = 0;
  const store = new LocalBucketStore(configuration, () => nowMs);

  for (let requestIndex = 0; requestIndex < 3; requestIndex++) store.consume('a');
  for (let outage = 0; outage < 10; outage++) assert.equal(store.consume('a')?.allowed, false);

  nowMs = 500;
  assert.equal(store.consume('a')?.tokens, 0.5);
  nowMs = 250;
  assert.equal(store.consume('a')?.tokens, 0.5);
  nowMs = 1000;
  assert.equal(store.consume('a')?.tokens, 0);
  nowMs = 61_000;
  assert.equal(store.consume('a')?.tokens, 9);
  assert.equal(store.size, 1);

  const restartedStore = new LocalBucketStore(configuration, () => nowMs);
  assert.equal(restartedStore.consume('a')?.tokens, 2);
});
