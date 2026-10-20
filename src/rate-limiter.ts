import type { Configuration } from './config.js';
import type { LocalBucketStore } from './stores/local-bucket-store.js';
import { RedisUnavailableError, type RedisBucketStore } from './stores/redis/redis-bucket-store.js';
import type { RateLimitDecision } from './token-bucket.js';

/** Select Redis or retained local state; the HTTP layer receives only one final decision. */
export class RateLimiter {
  private fallback = false;
  private recoveryStopped = false;
  private closed = false;
  private connectivityVersion = 0;
  private recoveryError: unknown;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly configuration: Pick<Configuration, 'policyFor' | 'redisProbeIntervalMs'>,
    private readonly redisStore: Pick<RedisBucketStore, 'consume' | 'probe' | 'close'>,
    private readonly localStore: Pick<LocalBucketStore, 'consume'>,
  ) {}

  async consume(apiKey: string): Promise<RateLimitDecision | undefined> {
    // Validate the request before touching either store.
    if (this.closed) throw new Error('Rate limiter is closed');
    if (this.configuration.policyFor(apiKey) === undefined) return undefined;

    // While Redis is unavailable, use the retained local balance.
    if (this.recoveryError !== undefined) throw this.recoveryError;
    // The same local store survives recovery, so another outage cannot grant a fresh allocation.
    if (this.fallback) return this.localStore.consume(apiKey);

    // Normal path: make one Redis attempt and keep its allowance or denial.
    try {
      return await this.redisStore.consume(apiKey);
    } catch (error) {
      if (!(error instanceof RedisUnavailableError)) throw error;
      if (this.closed) throw new Error('Rate limiter is closed', { cause: error });

      // Enter fallback only for connection failures or timeouts.
      // A newer failure invalidates an older recovery probe, including concurrent failures.
      this.connectivityVersion++;
      this.fallback = true;
      this.scheduleRecovery();

      // Redis may already have consumed a token. Never retry it; make at most one local decision.
      return this.localStore.consume(apiKey);
    }
  }

  private scheduleRecovery(): void {
    if (this.recoveryStopped || this.recoveryTimer !== undefined) return;

    // Schedule the next check only after the previous one has finished.
    this.recoveryTimer = setTimeout(() => { void this.checkRecovery(); }, this.configuration.redisProbeIntervalMs);
    this.recoveryTimer.unref();
  }

  private async checkRecovery(): Promise<void> {
    const version = this.connectivityVersion;

    // Check connectivity without spending a token.
    try {
      await this.redisStore.probe();
      // Accept recovery only if shutdown or a newer failure has not invalidated this check.
      if (!this.recoveryStopped && version === this.connectivityVersion) {
        // Resume from Redis as-is: local consumption is deliberately never merged.
        this.fallback = false;
        this.recoveryError = undefined;
      }
    } catch (error) {
      if (!this.recoveryStopped && version === this.connectivityVersion) {
        // Authentication/script/configuration errors must surface through the normal HTTP error handler.
        this.recoveryError = error instanceof RedisUnavailableError ? undefined : error;
      }
    } finally {
      // Keep the timer occupied throughout the probe so no request can start an overlapping check.
      this.recoveryTimer = undefined;
      if (this.fallback) this.scheduleRecovery();
    }
  }

  /** Stop new recovery checks immediately; in-flight results cannot change connectivity afterward. */
  stopRecovery(): void {
    if (this.recoveryStopped) return;

    this.recoveryStopped = true;
    this.connectivityVersion++;
    clearTimeout(this.recoveryTimer);
  }

  /** Called after HTTP draining (or its deadline); pending attempts cannot allocate local tokens afterward. */
  close(): void {
    if (this.closed) return;

    this.stopRecovery();
    this.closed = true;
    this.redisStore.close();
  }
}
