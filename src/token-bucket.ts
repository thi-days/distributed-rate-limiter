import type { Policy } from './config.js';

export interface BucketState {
  /** Available token balance, preserving fractional refill. */
  readonly tokens: number;
  /** Time in milliseconds of the last calculation, in the store's clock domain. */
  readonly lastRefillMs: number;
}

/** Shared store result; all durations are milliseconds. */
export interface RateLimitDecision {
  /** Whether this request consumed a token and may proceed. */
  readonly allowed: boolean;
  /** Token balance after this decision, including any fractional remainder. */
  readonly tokens: number;
  /** Whole tokens available for HTTP response metadata. */
  readonly remaining: number;
  /** Milliseconds until the resulting balance reaches one token; zero if already available. */
  readonly retryAfterMs: number;
}

export interface BucketUpdate {
  /** Recalculated balance and timestamp to persist, including on denials. */
  readonly state: BucketState;
  /** Request outcome and rate limit metadata corresponding to the updated state. */
  readonly decision: RateLimitDecision;
}

export function initialBucket(
  policy: Policy,
  nowMs: number,
  mode: 'full' | 'local',
): BucketState {
  return {
    tokens: mode === 'full' ? policy.capacity : Math.ceil(policy.capacity * 0.25),
    lastRefillMs: nowMs,
  };
}

/** Pure calculation for validated policies and finite timestamps in the same clock domain. */
export function consumeToken(policy: Policy, previousState: BucketState, nowMs: number): BucketUpdate {
  const lastRefillMs = Math.max(previousState.lastRefillMs, nowMs);
  const availableTokens = Math.min(
    policy.capacity,
    previousState.tokens + (lastRefillMs - previousState.lastRefillMs) * policy.refillPerMinute / 60_000,
  );
  const allowed = availableTokens >= policy.requestCost;
  const remainingTokens = allowed ? availableTokens - policy.requestCost : availableTokens;

  return {
    state: { tokens: remainingTokens, lastRefillMs },
    decision: {
      allowed,
      tokens: remainingTokens,
      remaining: Math.floor(remainingTokens),
      retryAfterMs: Math.max(0, 1 - remainingTokens) * 60_000 / policy.refillPerMinute,
    },
  };
}
