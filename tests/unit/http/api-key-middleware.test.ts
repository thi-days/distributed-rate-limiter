import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serve, get } from '../../helpers/http.js';

const policy = { capacity: 3, refillPerMinute: 60, requestCost: 1 } as const;
const allowance = { allowed: true, tokens: 2, remaining: 2, retryAfterMs: 0 };
const invalidKeys = [
  { name: 'missing field', headers: [] },
  { name: 'empty value', headers: ['X-API-Key', ''] },
  { name: 'space inside value', headers: ['X-API-Key', 'two words'] },
  { name: 'tab inside value', headers: ['X-API-Key', 'a\tb'] },
  { name: 'duplicate mixed-case fields', headers: ['X-API-Key', 'known', 'x-ApI-kEy', 'known'] },
];

for (const { name, headers } of invalidKeys) {
  test(`rejects ${name} before policy lookup or consumption`, async (t) => {
    const server = await serve(t, {
      configuration: { policyFor: () => assert.fail('must not look up invalid keys') },
      bucketStore: { consume: () => assert.fail('must not consume for invalid keys') },
      instanceId: 'api-test',
    });

    const response = await get(server, '/api/resource', headers);

    assert.equal(response.status, 400);
    assert.equal(response.body, '{"error":{"code":"INVALID_API_KEY"}}');
    assert.equal(response.headers.ratelimit, undefined);
  });
}

for (const apiKey of ['Known', 'known,other', 'unknown']) {
  test(`rejects unregistered key ${apiKey} before consumption`, async (t) => {
    const server = await serve(t, {
      configuration: { policyFor: (key) => key === 'known' ? policy : undefined },
      bucketStore: { consume: () => assert.fail('must not consume for unknown keys') },
      instanceId: 'api-test',
    });

    const response = await get(server, '/api/resource', ['X-API-Key', apiKey]);

    assert.equal(response.status, 403);
    assert.equal(response.body, '{"error":{"code":"UNKNOWN_API_KEY"}}');
  });
}

test('uses the parsed API key regardless of forwarded IP', async (t) => {
  const consumedKeys: string[] = [];
  const server = await serve(t, {
    configuration: { policyFor: (key) => key === 'known' ? policy : undefined },
    bucketStore: {
      consume(key) {
        consumedKeys.push(key);
        return allowance;
      },
    },
    instanceId: 'api-test',
  });

  for (const ip of ['1.1.1.1', '2.2.2.2']) {
    const response = await get(server, '/api/resource', [
      'X-API-Key', ' known ',
      'X-Forwarded-For', ip,
    ]);
    assert.equal(response.status, 200);
  }

  assert.deepEqual(consumedKeys, ['known', 'known']);
});
