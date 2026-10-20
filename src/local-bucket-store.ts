import { performance } from 'node:perf_hooks';
import type { Configuration } from './config.js';
import { consumeToken, initialBucket, type BucketState, type RateLimitDecision } from './token-bucket.js';

/** Process-local fallback state, retained for the lifetime of this store. */
export class LocalBucketStore {
  private readonly buckets = new Map<string, BucketState>();

  constructor(
    private readonly configuration: Pick<Configuration, 'policyFor'>,
    private readonly nowMs: () => number = () => performance.now(),
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  /** Unknown keys allocate nothing. No asynchronous boundary can split an update. */
  consume(apiKey: string): RateLimitDecision | undefined {
    const policy = this.configuration.policyFor(apiKey);

    if (policy === undefined) return undefined;

    const nowMs = this.nowMs();
    const previousState = this.buckets.get(apiKey) ?? initialBucket(policy, nowMs, 'local');
    const bucketUpdate = consumeToken(policy, previousState, nowMs);
    this.buckets.set(apiKey, bucketUpdate.state);

    return bucketUpdate.decision;
  }
}
