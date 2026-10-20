import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplication } from '../../../src/http/app.js';
import { serve, get } from '../../helpers/http.js';

const policy = { capacity: 3, refillPerMinute: 60, requestCost: 1 } as const;
const allowance = { allowed: true, tokens: 2, remaining: 2, retryAfterMs: 0 };

test('resource returns the demonstration response', async (t) => {
  const server = await serve(t, {
    configuration: { policyFor: () => policy },
    bucketStore: { consume: () => allowance },
    instanceId: 'api-test',
  });

  const response = await get(server);

  assert.equal(response.status, 200);
  assert.equal(response.body, '{"message":"ok"}');
  assert.equal(response.headers['x-instance-id'], 'api-test');
});

test('health bypasses identification, policy lookup, and limiting', async (t) => {
  const server = await serve(t, {
    configuration: { policyFor: () => assert.fail('health must bypass lookup') },
    bucketStore: { consume: () => assert.fail('health must bypass store') },
    instanceId: 'api-test',
  });

  const response = await get(server, '/health', ['X-API-Key', 'bad key']);

  assert.equal(response.status, 200);
  assert.equal(response.body, '{"message":"ok"}');
  assert.equal(response.headers['x-instance-id'], 'api-test');
  assert.equal(response.headers.ratelimit, undefined);
});

test('trust proxy remains disabled', () => {
  const app = createApplication({
    configuration: { policyFor: () => policy },
    bucketStore: { consume: () => allowance },
    instanceId: 'api-test',
  });

  assert.equal(app.get('trust proxy'), false);
});

test('rejects unsafe public instance labels', () => {
  assert.throws(() => createApplication({
    configuration: { policyFor: () => policy },
    bucketStore: { consume: () => allowance },
    instanceId: 'bad\r\nlabel',
  }));
});
