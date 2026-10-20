import {
  createClient, ConnectionTimeoutError, SocketClosedUnexpectedlyError,
  SocketTimeoutError, ClientOfflineError, ClientClosedError,
} from 'redis';
import { createHash } from 'node:crypto';
import type { Configuration, Policy } from '../../config.js';
import type { RateLimitDecision } from '../../token-bucket.js';
import { consumeScript } from './consume-script.js';
import { decodeRedisDecision } from './redis-decision.js';

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
  eval(script: string, options: {
    /** Single bucket key in the shared namespace. */
    keys: string[];
    /** Capacity in tokens and refill rate in tokens per minute. */
    arguments: string[];
  }): Promise<unknown>;
  /** Immediately close the connection and discard pending operations. */
  destroy(): void;
}

function isConnectionFailure(error: unknown): boolean {
  if (error instanceof ConnectionTimeoutError || error instanceof SocketTimeoutError ||
      error instanceof SocketClosedUnexpectedlyError || error instanceof ClientOfflineError || error instanceof ClientClosedError) return true;

  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(isConnectionFailure);

  return error instanceof Error && 'code' in error &&
    ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN']
      .includes(String(error.code));
}

/** One reusable client and its shared connection handshake. */
interface ConnectionSession {
  /** Redis client used by all attempts in this session. */
  readonly client: BucketConnection;
  /** Completes when the initial connection handshake finishes. */
  readonly ready: Promise<unknown>;
}

function createRedisConnection(): BucketConnection {
  const client = createClient({
    ...(process.env.REDIS_URL === undefined ? {} : { url: process.env.REDIS_URL }),
    disableOfflineQueue: true,
    socket: { reconnectStrategy: false },
  });
  // Command/connect promises report failures; always handle EventEmitter errors.
  client.on('error', () => {});
  return client;
}

/** Reuses a connection until failure or shutdown; consumption is never retried. */
export class RedisBucketStore {
  private session: ConnectionSession | undefined;
  private closed = false;
  private readonly timeoutMs: number;

  constructor(
    private readonly configuration: Pick<Configuration, 'policyFor'> & Partial<Pick<Configuration, 'redisTimeoutMs'>>,
    private readonly createConnection: () => BucketConnection = createRedisConnection,
  ) {
    this.timeoutMs = configuration.redisTimeoutMs ?? 20;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) throw new Error('Invalid Redis timeout');
  }

  async consume(apiKey: string): Promise<RateLimitDecision | undefined> {
    if (this.closed) throw new Error('Redis bucket store is closed');

    const policy = this.configuration.policyFor(apiKey);
    if (policy === undefined) return undefined;

    const session = this.getSession();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RedisUnavailableError(new Error('Redis attempt timed out'))), this.timeoutMs);
    });

    try {
      return await Promise.race([this.executeConsumption(session, apiKey, policy), deadline]);
    } catch (error) {
      if (error instanceof RedisUnavailableError || isConnectionFailure(error)) {
        if (this.session === session) this.discardSession();
        throw error instanceof RedisUnavailableError ? error : new RedisUnavailableError(error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private getSession(): ConnectionSession {
    if (this.session === undefined) {
      const client = this.createConnection();
      this.session = { client, ready: Promise.resolve().then(() => client.connect()) };
    }

    return this.session;
  }

  private async executeConsumption(session: ConnectionSession, apiKey: string, policy: Policy): Promise<RateLimitDecision> {
    await session.ready;

    // A timed-out or closed session must never submit a delayed consumption.
    if (this.closed || this.session !== session) throw new RedisUnavailableError(new Error('Connection discarded'));

    const result = await session.client.eval(consumeScript, {
      keys: [redisBucketKey(apiKey)], arguments: [String(policy.capacity), String(policy.refillPerMinute)],
    });
    return decodeRedisDecision(result, policy);
  }

  private discardSession(): void {
    const session = this.session;
    this.session = undefined;

    if (session?.client.isOpen) session.client.destroy();
  }

  /** Stop accepting work and close the reusable connection at application shutdown. */
  close(): void {
    this.closed = true;
    this.discardSession();
  }
}
