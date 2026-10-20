import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Policy } from '../../src/config.js';
import { consumeToken, initialBucket } from '../../src/token-bucket.js';
import { bucketReferences } from '../helpers/bucket-reference.js';

const policy: Policy = { capacity: 100, refillPerMinute: 100, requestCost: 1 };

test('full default bucket permits 100 requests, denies, and earns one token after 600ms', () => {
  let state = initialBucket(policy, 0, 'full');

  for (let requestIndex = 0; requestIndex < 100; requestIndex++) {
    const bucketUpdate = consumeToken(policy, state, 0);
    assert.equal(bucketUpdate.decision.allowed, true);
    assert.equal(bucketUpdate.decision.tokens, 99 - requestIndex);
    state = bucketUpdate.state;
  }

  const deniedUpdate = consumeToken(policy, state, 0);
  assert.equal(deniedUpdate.decision.allowed, false);
  assert.deepEqual(deniedUpdate.state, state);

  const partialUpdate = consumeToken(policy, deniedUpdate.state, 300);
  assert.deepEqual(partialUpdate.state, { tokens: 0.5, lastRefillMs: 300 });
  assert.deepEqual(partialUpdate.decision, { allowed: false, tokens: 0.5, remaining: 0, retryAfterMs: 300 });

  const allowedUpdate = consumeToken(policy, partialUpdate.state, 600);
  assert.equal(allowedUpdate.decision.allowed, true);
  assert.equal(allowedUpdate.state.tokens, 0);
});

test('backward time preserves timestamp and cannot cause duplicate refill', () => {
  const previousState = Object.freeze({ tokens: 0.5, lastRefillMs: 600 });
  const backwardUpdate = consumeToken(policy, previousState, 300);
  assert.deepEqual(backwardUpdate.state, previousState);
  assert.equal(backwardUpdate.decision.allowed, false);
  assert.equal(consumeToken(policy, backwardUpdate.state, 900).state.tokens, 0);

  const allowedUpdate = consumeToken(policy, { tokens: 2, lastRefillMs: 600 }, 300);
  assert.deepEqual(allowedUpdate.state, { tokens: 1, lastRefillMs: 600 });
});

test('refill is capped and HTTP remaining rounds fractional balances down', () => {
  const previousState = Object.freeze({ tokens: 99.5, lastRefillMs: 0 });
  assert.equal(consumeToken(policy, previousState, 60_000).state.tokens, 99);
  assert.deepEqual(previousState, { tokens: 99.5, lastRefillMs: 0 });
  assert.deepEqual(consumeToken(policy, previousState, 0).decision, {
    allowed: true, tokens: 98.5, remaining: 98, retryAfterMs: 0,
  });
});

for (const reference of bucketReferences) {
  test(`pure reference: ${reference.name}`, () => {
    let state = initialBucket(reference.policy, 0, 'local');

    for (const step of reference.steps) {
      for (let requestIndex = 0; requestIndex < step.calls; requestIndex++) {
        const bucketUpdate = consumeToken(reference.policy, state, step.atMs);
        state = bucketUpdate.state;
        assert.equal(bucketUpdate.decision.allowed, step.allowed);

        if (requestIndex === step.calls - 1) {
          assert.deepEqual(bucketUpdate.decision, {
            allowed: step.allowed, tokens: step.tokens,
            remaining: Math.floor(step.tokens), retryAfterMs: step.retryAfterMs,
          });
          assert.equal(state.lastRefillMs, step.atMs);
        }
      }
    }
  });
}
