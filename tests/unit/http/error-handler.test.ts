import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { jsonErrorHandler } from '../../../src/http/error-handler.js';
import { get, serve } from '../../helpers/http.js';

test('HTTP errors return JSON without internal details', async t => {
  const app = express();
  app.get('/api/resource', () => {
    throw new Error('secret');
  });
  app.use(jsonErrorHandler);
  const server = await serve(t, app);

  const response = await get(server);

  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'INTERNAL_ERROR' },
  });
});

test('delegates errors after headers instead of sending a second response', () => {
  const error = new Error('secret');
  const response = {
    headersSent: true,
    status: () => assert.fail('must not write again'),
  } as unknown as Response;
  let delegated: unknown;
  const next: NextFunction = (received: unknown) => {
    delegated = received;
  };

  jsonErrorHandler(error, {} as Request, response, next);

  assert.equal(delegated, error);
});
