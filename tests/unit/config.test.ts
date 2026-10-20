import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ConfigurationError, loadConfiguration } from '../../src/config.js';

const defaults = { capacity: 100, refillPerMinute: 100 };

/** Write an isolated configuration file and remove it when the test finishes. */
function fixture(t: TestContext, contents: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'rate-limit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const path = join(directory, 'config.json');
  writeFileSync(path, JSON.stringify(contents));

  return path;
}

test('defaults, independent overrides, case-sensitive and unknown lookup', (t) => {
  const path = fixture(t, { defaults, clients: [
    { apiKey: 'Default' }, { apiKey: 'capacity', capacity: 10 },
    { apiKey: 'refill', refillPerMinute: 20 },
    { apiKey: 'both', capacity: 1, refillPerMinute: 2 },
  ] });
  const config = loadConfiguration({ RATE_LIMIT_CONFIG_PATH: path });

  assert.deepEqual(config.policyFor('Default'), { ...defaults, requestCost: 1 });
  assert.deepEqual(config.policyFor('capacity'), { capacity: 10, refillPerMinute: 100, requestCost: 1 });
  assert.deepEqual(config.policyFor('refill'), { capacity: 100, refillPerMinute: 20, requestCost: 1 });
  assert.deepEqual(config.policyFor('both'), { capacity: 1, refillPerMinute: 2, requestCost: 1 });

  assert.equal(config.policyFor('default'), undefined);
  assert.equal(config.policyFor('unknown'), undefined);

  assert.equal(config.redisTimeoutMs, 20);
  assert.equal(config.redisProbeIntervalMs, 1000);

  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.policyFor('Default')));
  assert.equal(config.policyFor('Default'), config.policyFor('Default'));

  writeFileSync(path, JSON.stringify({ defaults: { capacity: 7, refillPerMinute: 8 }, clients: [{ apiKey: 'Default' }] }));

  assert.equal(config.policyFor('Default')?.capacity, 100);
  assert.equal(loadConfiguration({ RATE_LIMIT_CONFIG_PATH: path }).policyFor('Default')?.capacity, 7);
});

test('invalid schema, policies, and client keys are rejected without exposing input', (t) => {
  const invalid: unknown[] = [null, [], {}, { defaults }, { defaults, clients: [] },
    { defaults, clients: [null] }, { defaults, clients: [{ apiKey: 'secret' }, { apiKey: 'secret' }] },
    { defaults, clients: [{ apiKey: 'secret', requestCost: 2 }] },
    { defaults, clients: [{ apiKey: 'secret' }], extra: true }];

  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null, true, {}, []]) {
    for (const field of ['capacity', 'refillPerMinute']) {
      invalid.push({ defaults: { ...defaults, [field]: value }, clients: [{ apiKey: 'secret' }] });
      invalid.push({ defaults, clients: [{ apiKey: 'secret', [field]: value }] });
    }
  }

  for (const apiKey of ['', ' ', 'a b', 'a\tb', 'a\nb', 'a\u00a0b', 123, null]) {
    invalid.push({ defaults, clients: [{ apiKey }] });
  }

  for (const input of invalid) {
    const path = fixture(t, input);

    assert.throws(() => loadConfiguration({ RATE_LIMIT_CONFIG_PATH: path }), (error) => {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(!error.message.includes('secret'));
      assert.equal(error.cause, undefined);

      return true;
    });
  }
});

test('Redis settings accept overrides and reject invalid values', (t) => {
  const path = fixture(t, { defaults, clients: [{ apiKey: 'demo' }] });
  const env = { RATE_LIMIT_CONFIG_PATH: path, REDIS_TIMEOUT_MS: '30', REDIS_PROBE_INTERVAL_MS: '2000' };

  assert.equal(loadConfiguration(env).redisTimeoutMs, 30);
  assert.equal(loadConfiguration(env).redisProbeIntervalMs, 2000);

  for (const field of ['REDIS_TIMEOUT_MS', 'REDIS_PROBE_INTERVAL_MS']) {
    for (const value of ['', ' ', '0', '-1', '0.5', 'Infinity', 'NaN', '9007199254740992', 'redis://secret']) {
      assert.throws(() => loadConfiguration({ ...env, [field]: value }), ConfigurationError);
    }
  }
});

test('missing, unreadable and malformed configuration fails startup with redacted errors', (t) => {
  const path = fixture(t, {});
  writeFileSync(path, '{"apiKey":"sensitive-key", "url":"redis://user:password@host"');

  for (const configPath of ['', `${path}/secret-path`, path]) {
    assert.throws(() => loadConfiguration({ RATE_LIMIT_CONFIG_PATH: configPath }), ConfigurationError);

    const result = spawnSync(process.execPath, ['dist/index.js'], {
      encoding: 'utf8', env: { ...process.env, RATE_LIMIT_CONFIG_PATH: configPath },
    });

    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid rate limit configuration/);
    assert.doesNotMatch(result.stderr, /sensitive-key|password|secret-path/);
    assert.equal(result.stdout, '');
  }

  assert.throws(() => loadConfiguration({}), ConfigurationError);
});
