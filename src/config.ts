import { readFileSync } from 'node:fs';

export interface Policy {
  /** Maximum number of tokens the bucket can hold. */
  readonly capacity: number;
  /** Number of tokens replenished per minute, continuously over elapsed time. */
  readonly refillPerMinute: number;
  /** Tokens consumed by each allowed request; fixed at one. */
  readonly requestCost: 1;
}

export interface Configuration {
  /** Maximum duration in milliseconds for a Redis attempt, including connection waiting. */
  readonly redisTimeoutMs: number;
  /** Interval in milliseconds between Redis recovery probes during fallback. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Reject unknown properties; required fields are validated separately. */
function isAllowedFieldSet(value: Record<string, unknown>, allowedFields: string[]): boolean {
  return Object.keys(value).every((field) => allowedFields.includes(field));
}

/** Use the default value only for an absent variable; invalid supplied values fail startup. */
function setting(value: string | undefined, defaultValue: number, settingName: string): number {
  const parsedValue = value === undefined ? defaultValue : Number(value);

  if (!isPositiveInteger(parsedValue)) throw new ConfigurationError(`${settingName} must be a positive safe integer`);

  return parsedValue;
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
  const configPath = env.RATE_LIMIT_CONFIG_PATH;

  if (!configPath || configPath.trim() === '') throw new ConfigurationError('RATE_LIMIT_CONFIG_PATH is required');

  let configData: unknown;

  try {
    configData = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  } catch {
    // Do not expose filesystem paths, JSON fragments, keys, or underlying error causes.
    throw new ConfigurationError('unable to read or parse the JSON file');
  }

  if (!isRecord(configData) || !isAllowedFieldSet(configData, ['defaults', 'clients']) ||
      !isRecord(configData.defaults) || !isAllowedFieldSet(configData.defaults, ['capacity', 'refillPerMinute']) ||
      !isPositiveInteger(configData.defaults.capacity) || !isPositiveInteger(configData.defaults.refillPerMinute) ||
      !Array.isArray(configData.clients) || configData.clients.length === 0) {
    throw new ConfigurationError('expected defaults and a nonempty clients list with valid policy values');
  }

  const policies = new Map<string, Policy>();

  for (const client of configData.clients as unknown[]) {
    if (!isRecord(client) || !isAllowedFieldSet(client, ['apiKey', 'capacity', 'refillPerMinute']) ||
        typeof client.apiKey !== 'string' || !/^[^\s]+$/u.test(client.apiKey) ||
        policies.has(client.apiKey) ||
        ('capacity' in client && !isPositiveInteger(client.capacity)) ||
        ('refillPerMinute' in client && !isPositiveInteger(client.refillPerMinute))) {
      throw new ConfigurationError('clients must have distinct nonempty whitespace-free keys and valid overrides');
    }

    policies.set(client.apiKey, Object.freeze({
      capacity: (client.capacity ?? configData.defaults.capacity) as number,
      refillPerMinute: (client.refillPerMinute ?? configData.defaults.refillPerMinute) as number,
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
