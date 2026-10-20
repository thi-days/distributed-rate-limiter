import type { Policy } from '../../config.js';
import type { RateLimitDecision } from '../../token-bucket.js';

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

