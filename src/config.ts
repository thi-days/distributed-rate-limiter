import { readFileSync } from 'node:fs';

export interface Policy {
  readonly capacity: number;
  readonly refillPerMinute: number;
  readonly requestCost: 1;
}

export interface Configuration {
  readonly redisTimeoutMs: number;
  readonly redisProbeIntervalMs: number;
  /** Exact, case-sensitive lookup; undefined means the key is not registered. */
  readonly policyFor: (apiKey: string) => Policy | undefined;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid rate limit configuration: ${message}`);
    this.name = 'ConfigurationError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Reject unknown properties; required fields are validated separately. */
function fields(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Use the fallback only for an absent variable; invalid supplied values fail startup. */
function setting(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!positiveInteger(parsed)) throw new ConfigurationError(`${name} must be a positive safe integer`);

  return parsed;
}

/**
 * Read and validate the startup JSON file referenced by RATE_LIMIT_CONFIG_PATH.
 * Each client override replaces only its supplied field. The private registry and
 * frozen policies form a snapshot: later file or environment changes have no effect.
 *
 * @param env Environment snapshot; defaults to process.env and does not load .env files.
 * @throws {ConfigurationError} If the file, schema, policies, or Redis timings are invalid.
 * Error messages omit configuration contents and underlying filesystem/parser errors.
 */
export function loadConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Configuration {
  const path = env.RATE_LIMIT_CONFIG_PATH;

  if (!path || path.trim() === '') throw new ConfigurationError('RATE_LIMIT_CONFIG_PATH is required');

  let input: unknown;

  try {
    input = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    // Do not expose filesystem paths, JSON fragments, keys, or underlying error causes.
    throw new ConfigurationError('unable to read or parse the JSON file');
  }

  if (!record(input) || !fields(input, ['defaults', 'clients']) ||
      !record(input.defaults) || !fields(input.defaults, ['capacity', 'refillPerMinute']) ||
      !positiveInteger(input.defaults.capacity) || !positiveInteger(input.defaults.refillPerMinute) ||
      !Array.isArray(input.clients) || input.clients.length === 0) {
    throw new ConfigurationError('expected defaults and a nonempty clients list with valid policy values');
  }

  const policies = new Map<string, Policy>();

  for (const client of input.clients as unknown[]) {
    if (!record(client) || !fields(client, ['apiKey', 'capacity', 'refillPerMinute']) ||
        typeof client.apiKey !== 'string' || !/^[^\s]+$/u.test(client.apiKey) ||
        policies.has(client.apiKey) ||
        ('capacity' in client && !positiveInteger(client.capacity)) ||
        ('refillPerMinute' in client && !positiveInteger(client.refillPerMinute))) {
      throw new ConfigurationError('clients must have distinct nonempty whitespace-free keys and valid overrides');
    }

    policies.set(client.apiKey, Object.freeze({
      capacity: (client.capacity ?? input.defaults.capacity) as number,
      refillPerMinute: (client.refillPerMinute ?? input.defaults.refillPerMinute) as number,
      requestCost: 1,
    }));
  }

  // Keep the mutable Map private; freezing a Map would not prevent set/delete calls.
  return Object.freeze({
    redisTimeoutMs: setting(env.REDIS_TIMEOUT_MS, 20, 'REDIS_TIMEOUT_MS'),
    redisProbeIntervalMs: setting(env.REDIS_PROBE_INTERVAL_MS, 1_000, 'REDIS_PROBE_INTERVAL_MS'),
    policyFor: (apiKey: string) => policies.get(apiKey),
  });
}
