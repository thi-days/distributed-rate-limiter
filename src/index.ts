import { loadConfiguration } from './config.js';

export { ConfigurationError, loadConfiguration } from './config.js';
export type { Configuration, Policy } from './config.js';
export { LocalBucketStore } from './stores/local-bucket-store.js';
export { consumeToken, initialBucket } from './token-bucket.js';
export type { BucketState, BucketUpdate, RateLimitDecision } from './token-bucket.js';

if (require.main === module) {
  try {
    loadConfiguration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid rate limit configuration');
    process.exitCode = 1;
  }
}

export { RedisBucketStore, RedisUnavailableError, redisBucketKey } from './stores/redis/redis-bucket-store.js';
