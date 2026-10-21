import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';
import { closeHttpServer } from '../../src/main.js';
import { get } from '../helpers/http.js';

// Exercise graceful draining and the deadline with the same controllable request.
for (const forceClose of [false, true]) {
  test(
    forceClose
      ? 'closes stalled connections at the deadline'
      : 'waits for active requests to finish',
    async t => {
      // Hold the response open so shutdown has active work to wait for.
      let markEntered!: () => void;
      let finishRequest!: () => void;
      const requestEntered = new Promise<void>(resolve => {
        markEntered = resolve;
      });
      const requestReleased = new Promise<void>(resolve => {
        finishRequest = resolve;
      });
      const app = express();
      app.get('/api/resource', async (_req, res) => {
        markEntered();
        await requestReleased;
        res.json({ message: 'ok' });
      });
      const server = app.listen(0);
      t.after(() => {
        finishRequest();
        server.closeAllConnections();
        server.close();
      });
      await once(server, 'listening');
      const response = get(server);
      // Handle the expected disconnect before triggering it.
      const result = forceClose ? assert.rejects(response) : response;
      await requestEntered;

      // Start shutdown while the request is active; release only the graceful case.
      let closed = false;
      const shutdown = closeHttpServer(server, forceClose ? 30 : 1000).then(
        () => {
          closed = true;
        },
      );
      assert.equal(closed, false);
      if (!forceClose) finishRequest();
      await shutdown;

      // Both paths close the server, but only graceful draining completes the response.
      assert.equal(closed, true);
      if (forceClose) await result;
      else assert.equal((await response).status, 200);
    },
  );
}

// Use a real child process to cover startup wiring, signals, and Redis cleanup.
for (const redisAvailable of [true, false]) {
  test(
    `executable shuts down with repeated signals ${redisAvailable ? 'with default settings' : 'without Redis'}`,
    { timeout: 5000 },
    async t => {
      const child = spawn(process.execPath, ['dist/main.js'], {
        env: {
          ...process.env,
          PORT: '0',
          ...(!redisAvailable ? { REDIS_URL: 'redis://127.0.0.1:1' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      t.after(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      });

      // Observe exit before sending signals, and discover the chosen port from startup.
      const exited = once(child, 'exit');
      let output = '';
      const port = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', () =>
          reject(new Error('Process exited before listening')),
        );
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          const match = /listening on port (\d+)/u.exec(output);
          if (match) resolve(Number(match[1]));
        });
      });
      // Exercise the real startup wiring before sending shutdown signals.
      if (!redisAvailable) {
        const resource = await fetch(`http://127.0.0.1:${port}/api/resource`, {
          headers: { 'X-API-Key': 'demo-client' },
        });
        assert.equal(resource.status, 200);
        await resource.text();
      }
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(response.status, 200);
      await response.text();

      // Pause first so a fast shutdown cannot outrun delivery of the second signal.
      child.kill('SIGSTOP');
      child.kill('SIGTERM');
      child.kill('SIGINT');
      child.kill('SIGCONT');

      // A normal exit proves the handlers completed instead of a signal killing the child.
      const [code, signal] = await exited;
      assert.equal(code, 0);
      assert.equal(signal, null);
    },
  );
}

test('importing application modules does not start the service or install signal handlers', () => {
  // A fresh process keeps module caches and existing signal handlers out of the check.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const assert = require('node:assert/strict');
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    require('./dist/http/app.js');
    require('./dist/main.js');
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), before);
  `,
    ],
    { encoding: 'utf8', timeout: 2000 },
  );

  // The timeout also catches imports that accidentally leave a server running.
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
