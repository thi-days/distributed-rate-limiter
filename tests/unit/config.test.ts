import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ConfigurationError, loadConfiguration } from '../../src/config.js';

const defaults = { capacity: 100, refillPerMinute: 100 };

/** Write an isolated configuration file and remove it when the test finishes. */
function fixture(context: TestContext, contents: unknown) {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'rate-limit-'));
  context.after(() => rmSync(tempDirectory, { recursive: true, force: true }));

  const configPath = join(tempDirectory, 'config.json');
  writeFileSync(configPath, JSON.stringify(contents));

  return configPath;
}

test('defaults, independent overrides, case-sensitive and unknown lookup', (context) => {
  const configPath = fixture(context, { defaults, clients: [
    { apiKey: 'Default' }, { apiKey: 'capacity', capacity: 10 },
    { apiKey: 'refill', refillPerMinute: 20 },
    { apiKey: 'both', capacity: 1, refillPerMinute: 2 },
  ] });
  const configuration = loadConfiguration({ RATE_LIMIT_CONFIG_PATH: configPath });

  assert.deepEqual(configuration.policyFor('Default'), { ...defaults, requestCost: 1 });
  assert.deepEqual(configuration.policyFor('capacity'), { capacity: 10, refillPerMinute: 100, requestCost: 1 });
  assert.deepEqual(configuration.policyFor('refill'), { capacity: 100, refillPerMinute: 20, requestCost: 1 });
  assert.deepEqual(configuration.policyFor('both'), { capacity: 1, refillPerMinute: 2, requestCost: 1 });

  assert.equal(configuration.policyFor('default'), undefined);
  assert.equal(configuration.policyFor('unknown'), undefined);

  assert.equal(configuration.redisTimeoutMs, 20);
  assert.equal(configuration.redisProbeIntervalMs, 1000);

  assert.ok(Object.isFrozen(configuration));
  assert.ok(Object.isFrozen(configuration.policyFor('Default')));
  assert.equal(configuration.policyFor('Default'), configuration.policyFor('Default'));

  writeFileSync(configPath, JSON.stringify({ defaults: { capacity: 7, refillPerMinute: 8 }, clients: [{ apiKey: 'Default' }] }));

  assert.equal(configuration.policyFor('Default')?.capacity, 100);
  assert.equal(loadConfiguration({ RATE_LIMIT_CONFIG_PATH: configPath }).policyFor('Default')?.capacity, 7);
});

test('invalid schema, policies, and client keys are rejected without exposing input', (context) => {
  const invalidConfigs: unknown[] = [null, [], {}, { defaults }, { defaults, clients: [] },
    { defaults, clients: [null] }, { defaults, clients: [{ apiKey: 'secret' }, { apiKey: 'secret' }] },
    { defaults, clients: [{ apiKey: 'secret', requestCost: 2 }] },
    { defaults, clients: [{ apiKey: 'secret' }], extra: true }];

  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null, true, {}, []]) {
    for (const field of ['capacity', 'refillPerMinute']) {
      invalidConfigs.push({ defaults: { ...defaults, [field]: value }, clients: [{ apiKey: 'secret' }] });
      invalidConfigs.push({ defaults, clients: [{ apiKey: 'secret', [field]: value }] });
    }
  }

  for (const apiKey of ['', ' ', 'a b', 'a\tb', 'a\nb', 'a\u00a0b', 123, null]) {
    invalidConfigs.push({ defaults, clients: [{ apiKey }] });
  }

  for (const invalidConfig of invalidConfigs) {
    const configPath = fixture(context, invalidConfig);

    assert.throws(() => loadConfiguration({ RATE_LIMIT_CONFIG_PATH: configPath }), (error) => {
      assert.ok(error instanceof ConfigurationError);
      assert.ok(!error.message.includes('secret'));
      assert.equal(error.cause, undefined);

      return true;
    });
  }
});

test('Redis settings accept overrides and reject invalid values', (context) => {
  const configPath = fixture(context, { defaults, clients: [{ apiKey: 'demo' }] });
  const env = { RATE_LIMIT_CONFIG_PATH: configPath, REDIS_TIMEOUT_MS: '30', REDIS_PROBE_INTERVAL_MS: '2000' };

  assert.equal(loadConfiguration(env).redisTimeoutMs, 30);
  assert.equal(loadConfiguration(env).redisProbeIntervalMs, 2000);

  for (const field of ['REDIS_TIMEOUT_MS', 'REDIS_PROBE_INTERVAL_MS']) {
    for (const value of ['', ' ', '0', '-1', '0.5', 'Infinity', 'NaN', '9007199254740992', 'redis://secret']) {
      assert.throws(() => loadConfiguration({ ...env, [field]: value }), ConfigurationError);
    }
  }
});

test('missing, unreadable and malformed configuration fails startup with redacted errors', (context) => {
  const configPath = fixture(context, {});
  writeFileSync(configPath, '{"apiKey":"sensitive-key", "url":"redis://user:password@host"');

  for (const testedPath of ['', `${configPath}/secret-path`, configPath]) {
    assert.throws(() => loadConfiguration({ RATE_LIMIT_CONFIG_PATH: testedPath }), ConfigurationError);

    const result = spawnSync(process.execPath, ['dist/index.js'], {
      encoding: 'utf8', env: { ...process.env, RATE_LIMIT_CONFIG_PATH: testedPath },
    });

    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid rate limit configuration/);
    assert.doesNotMatch(result.stderr, /sensitive-key|password|secret-path/);
    assert.equal(result.stdout, '');
  }

  assert.throws(() => loadConfiguration({}), ConfigurationError);
});
