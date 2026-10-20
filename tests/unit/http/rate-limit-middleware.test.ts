import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serve, get } from '../../helpers/http.js';

const policy = { capacity: 3, refillPerMinute: 60, requestCost: 1 } as const;

test('consumes once and invokes the resource handler once on allowance', async (t) => {
  let attempts = 0;
  let handled = 0;
  const server = await serve(t, {
    configuration: { policyFor: () => policy },
    bucketStore: {
      consume() {
        attempts++;
        return { allowed: true, tokens: 2.9, remaining: 2, retryAfterMs: 0 };
      },
    },
    instanceId: 'api-test',
    resourceHandler(_req, res) {
      handled++;
      res.json({ message: 'ok' });
    },
  });

  const response = await get(server);

  assert.equal(response.status, 200);
  assert.equal(response.headers['ratelimit-policy'], '"token-bucket";q=3');
  assert.equal(response.headers.ratelimit, '"token-bucket";r=2');
  assert.equal(response.headers['retry-after'], undefined);
  assert.equal(attempts, 1);
  assert.equal(handled, 1);
});

for (const { retryAfterMs, seconds } of [
  { retryAfterMs: 0, seconds: '1' },
  { retryAfterMs: 1, seconds: '1' },
  { retryAfterMs: 1001, seconds: '2' },
]) {
  test(`denial rounds ${retryAfterMs}ms to Retry-After ${seconds}s`, async (t) => {
    let attempts = 0;
    const server = await serve(t, {
      configuration: { policyFor: () => policy },
      bucketStore: {
        consume() {
          attempts++;
          return { allowed: false, tokens: 0.4, remaining: 0, retryAfterMs };
        },
      },
      instanceId: 'api-test',
      resourceHandler: () => assert.fail('denial must not invoke resource handler'),
    });

    const response = await get(server);

    assert.equal(response.status, 429);
    assert.equal(response.body, '{"error":{"code":"RATE_LIMIT_EXCEEDED"}}');
    assert.equal(response.headers['ratelimit-policy'], '"token-bucket";q=3');
    assert.equal(response.headers.ratelimit, '"token-bucket";r=0');
    assert.equal(response.headers['retry-after'], seconds);
    assert.equal(attempts, 1);
  });
}
