import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('compiled package entry point loads successfully in Node.js', () => {
  const result = spawnSync(process.execPath, ['-e', "const assert = require('node:assert/strict'); const before = ['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s)); require('./dist/index.js'); require('./dist/main.js'); require('./dist/http/app.js'); assert.deepEqual(['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s)), before)"], {
    encoding: 'utf8',
    timeout: 2000,
    env: { ...process.env, RATE_LIMIT_CONFIG_PATH: 'config/demo.json' },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
