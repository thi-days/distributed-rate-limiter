import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { jsonErrorHandler } from '../../../src/http/error-handler.js';
import { serve, get } from '../../helpers/http.js';

const policy = { capacity: 3, refillPerMinute: 60, requestCost: 1 } as const;
const allowance = { allowed: true, tokens: 2, remaining: 2, retryAfterMs: 0 };
const storeFailures = [
  {
    name: 'synchronous store error',
    consume() { throw new Error('secret'); },
  },
  {
    name: 'asynchronous store rejection',
    consume: () => Promise.reject(new Error('secret')),
  },
  {
    name: 'missing store decision',
    consume: () => undefined,
  },
];

for (const { name, consume } of storeFailures) {
  test(`${name} returns redacted JSON without retrying`, async (t) => {
    let attempts = 0;
    const server = await serve(t, {
      configuration: { policyFor: () => policy },
      bucketStore: {
        consume() {
          attempts++;
          return consume();
        },
      },
      instanceId: 'api-test',
      resourceHandler: () => assert.fail('failed consumption must not reach handler'),
    });

    const response = await get(server);

    assert.equal(response.status, 500);
    assert.equal(response.body, '{"error":{"code":"INTERNAL_ERROR"}}');
    assert.equal(response.headers.ratelimit, undefined);
    assert.equal((await get(server, '/health')).status, 200);
    assert.equal(attempts, 1);
  });
}

const handlerFailures: { name: string; handler: RequestHandler }[] = [
  {
    name: 'synchronous handler error',
    handler() { throw new Error('secret'); },
  },
  {
    name: 'asynchronous handler rejection',
    handler: () => Promise.reject(new Error('secret')),
  },
];

for (const { name, handler } of handlerFailures) {
  test(`${name} returns redacted JSON`, async (t) => {
    const server = await serve(t, {
      configuration: { policyFor: () => policy },
      bucketStore: { consume: () => allowance },
      instanceId: 'api-test',
      resourceHandler: handler,
    });

    const response = await get(server);

    assert.equal(response.status, 500);
    assert.equal(response.body, '{"error":{"code":"INTERNAL_ERROR"}}');
  });
}

test('delegates an error after headers without writing a second response', () => {
  const error = new Error('secret');
  let delegated = 0;
  const response = {
    headersSent: true,
    status: () => assert.fail('must not write a second response'),
  } as unknown as Response;
  const next: NextFunction = (received: unknown) => {
    assert.equal(received, error);
    delegated++;
  };

  jsonErrorHandler(error, {} as Request, response, next);

  assert.equal(delegated, 1);
});

test('closes the connection when a handler rejects after sending headers', async (t) => {
  let attempts = 0;
  const server = await serve(t, {
    configuration: { policyFor: () => policy },
    bucketStore: {
      consume() {
        attempts++;
        return allowance;
      },
    },
    instanceId: 'api-test',
    resourceHandler(_req, res) {
      res.write('partial');
      return Promise.reject(new Error('secret'));
    },
  });

  await assert.rejects(get(server));

  assert.equal(attempts, 1);
});
