import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeRedisDecision } from '../../../../src/stores/redis/redis-decision.js';

const policy = { capacity: 10, refillPerMinute: 60, requestCost: 1 } as const;

test('decode allowed and fractional denial metadata; reject malformed results', () => {
  assert.deepEqual(decodeRedisDecision([0, '0.25'], policy), {
    allowed: false, tokens: 0.25, remaining: 0, retryAfterMs: 750,
  });
  assert.deepEqual(decodeRedisDecision([1, '1.5'], policy), {
    allowed: true, tokens: 1.5, remaining: 1, retryAfterMs: 0,
  });
  for (const result of [null, [2, '0'], [0, ''], [0, 'NaN'], [0, '-1'], [1, '10'], [0, '1'], [1, 9]]) {
    assert.throws(() => decodeRedisDecision(result, policy));
  }
});

