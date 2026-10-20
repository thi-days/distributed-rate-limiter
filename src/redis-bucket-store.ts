import {
  createClient, ConnectionTimeoutError, SocketClosedUnexpectedlyError,
  SocketTimeoutError, ClientOfflineError, ClientClosedError,
} from 'redis';
import { createHash } from 'node:crypto';
import type { Configuration, Policy } from './config.js';
import type { RateLimitDecision } from './token-bucket.js';

// EVAL avoids a script-cache retry path entirely. Decimal strings preserve Lua fractions.
const consumeScript = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + tonumber(time[2]) / 1000
local state = redis.call('HMGET', KEYS[1], 'tokens', 'last_refill')
local tokens = capacity
local previous = now
if state[1] or state[2] then
  tokens = tonumber(state[1])
  previous = tonumber(state[2])
  if not tokens or not previous or tokens < 0 or tokens > capacity then
    return redis.error_reply('Invalid bucket state')
  end
end
now = math.max(now, previous)
tokens = math.min(capacity, tokens + (now - previous) * rate / 60000)
local allowed = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
end
redis.call('HSET', KEYS[1], 'tokens', string.format('%.17g', tokens),
  'last_refill', string.format('%.17g', now))
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * 60000 / rate))
return {allowed, string.format('%.17g', tokens)}
`;

/** Shared namespace; hashing keeps raw API keys out of Redis key names. */
export function redisBucketKey(apiKey: string): string {
  return `rate-limiter:bucket:${createHash('sha256').update(apiKey).digest('hex')}`;
}

/** Connection failure or bounded-attempt timeout eligible for local fallback. */
export class RedisUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Redis bucket store unavailable', { cause });
    this.name = 'RedisUnavailableError';
  }
}

/** Minimal connection contract, also used to test uncertain command outcomes. */
export interface BucketConnection {
  /** Whether the connection has been opened, including an in-progress handshake. */
  readonly isOpen: boolean;
  /** Establish the connection; called once per connection instance. */
  connect(): Promise<unknown>;
  /** Execute one atomic consumption, without retries. */
  eval(script: string, options: { /** Single bucket key. */ keys: string[]; /** Capacity and tokens per minute. */ arguments: string[] }): Promise<unknown>;
  /** Immediately close the connection and discard pending operations. */
  destroy(): void;
}

function connectionFailure(error: unknown): boolean {
  if (error instanceof ConnectionTimeoutError || error instanceof SocketTimeoutError ||
      error instanceof SocketClosedUnexpectedlyError || error instanceof ClientOfflineError || error instanceof ClientClosedError) return true;

  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(connectionFailure);

  return error instanceof Error && 'code' in error &&
    ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN']
      .includes(String(error.code));
}

export function decodeRedisDecision(result: unknown, policy: Policy): RateLimitDecision {
  if (!Array.isArray(result) || result.length !== 2 ||
      (result[0] !== 0 && result[0] !== 1) || typeof result[1] !== 'string' || result[1].trim() === '') {
    throw new Error('Malformed Redis bucket decision');
  }

  const tokens = Number(result[1]);
  const allowed = result[0] === 1;

  if (!Number.isFinite(tokens) || tokens < 0 || tokens > policy.capacity ||
      (allowed ? tokens > policy.capacity - 1 : tokens >= 1)) {
    throw new Error('Malformed Redis bucket balance');
  }

  return {
    allowed, tokens, remaining: Math.floor(tokens),
    retryAfterMs: Math.max(0, 1 - tokens) * 60_000 / policy.refillPerMinute,
  };
}

/** Reuses a connection until failure or shutdown; consumption is never retried. */
export class RedisBucketStore {
  private connection: BucketConnection | undefined;
  private connecting: Promise<unknown> | undefined;
  private closed = false;

  constructor(
    private readonly configuration: Pick<Configuration, 'policyFor'> & Partial<Pick<Configuration, 'redisTimeoutMs'>>,
    private readonly createConnection: () => BucketConnection = () => {
      const client = createClient({
        ...(process.env.REDIS_URL === undefined ? {} : { url: process.env.REDIS_URL }),
        disableOfflineQueue: true,
        socket: { reconnectStrategy: false },
      });
      // Command/connect promises report failures; always handle EventEmitter errors.
      client.on('error', () => {});
      return client;
    },
  ) {
    const timeout = configuration.redisTimeoutMs ?? 20;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('Invalid Redis timeout');
  }

  async consume(apiKey: string): Promise<RateLimitDecision | undefined> {
    if (this.closed) throw new Error('Redis bucket store is closed');

    const policy = this.configuration.policyFor(apiKey);
    if (policy === undefined) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let connection: BucketConnection | undefined;

    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RedisUnavailableError(new Error('Redis attempt timed out'))),
          this.configuration.redisTimeoutMs ?? 20);
      });
      const operation = async (): Promise<RateLimitDecision> => {
        if (this.connection === undefined) {
          this.connection = this.createConnection();
          this.connecting = this.connection.connect();
        }
        connection = this.connection;
        await this.connecting;
        // A timed-out or closed connection must never submit a delayed consumption.
        if (this.closed || this.connection !== connection) throw new RedisUnavailableError(new Error('Connection discarded'));

        return decodeRedisDecision(await connection.eval(consumeScript, {
          keys: [redisBucketKey(apiKey)], arguments: [String(policy.capacity), String(policy.refillPerMinute)],
        }), policy);
      };
      return await Promise.race([operation(), deadline]);
    } catch (error) {
      if (error instanceof RedisUnavailableError || connectionFailure(error)) {
        if (connection !== undefined && this.connection === connection) this.discard();
        throw error instanceof RedisUnavailableError ? error : new RedisUnavailableError(error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private discard(): void {
    const connection = this.connection;
    this.connection = undefined;
    this.connecting = undefined;
    if (connection?.isOpen) connection.destroy();
  }

  /** Stop accepting work and close the reusable connection at application shutdown. */
  close(): void {
    this.closed = true;
    this.discard();
  }
}
