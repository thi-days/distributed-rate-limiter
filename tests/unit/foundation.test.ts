import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('compiled package entry point loads successfully in Node.js', () => {
  const result = spawnSync(process.execPath, ['dist/index.js'], {
    encoding: 'utf8',
    env: { ...process.env, RATE_LIMIT_CONFIG_PATH: 'config/demo.json' },
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
