import type { RateLimitDecision } from '../token-bucket.js';
import type { ResourceMiddleware } from './context.js';

export interface BucketStore {
  /** Make one consumption attempt without retrying uncertain outcomes. */
  consume(apiKey: string): RateLimitDecision | undefined | Promise<RateLimitDecision | undefined>;
}

export function createRateLimitMiddleware(bucketStore: BucketStore): ResourceMiddleware {
  const rateLimit: ResourceMiddleware = async (_req, res, next) => {
    const decision = await bucketStore.consume(res.locals.apiKey);
    if (decision === undefined) throw new Error('Missing decision for registered key');

    const policy = res.locals.policy;
    res.setHeader('RateLimit-Policy', `"token-bucket";q=${policy.capacity}`);
    res.setHeader('RateLimit', `"token-bucket";r=${Math.floor(decision.tokens)}`);
    if (!decision.allowed) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
      res.status(429).json({ error: { code: 'RATE_LIMIT_EXCEEDED' } });
      return;
    }

    next();
  };

  return rateLimit;
}
