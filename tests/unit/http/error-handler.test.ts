import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { jsonErrorHandler } from '../../../src/http/error-handler.js';
import { get, serve } from '../../helpers/http.js';

test('HTTP errors return JSON without internal details', async t => {
  // Mount a failing route before the error handler, as in the application.
  const app = express();
  app.get('/api/resource', () => {
    throw new Error('secret');
  });
  app.use(jsonErrorHandler);
  const server = await serve(t, app);

  const response = await get(server);

  // Clients receive the public error code, never the original exception message.
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), {
    error: { code: 'INTERNAL_ERROR' },
  });
});

test('delegates errors after headers instead of sending a second response', () => {
  // Pretend the response has started; any attempt to write again must fail.
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

  // Express must receive the original error to finish handling the connection.
  assert.equal(delegated, error);
});
