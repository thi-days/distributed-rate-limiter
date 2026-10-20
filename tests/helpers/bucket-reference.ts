import type { Policy } from '../../src/config.js';

/** Store-independent sequences for the local store and future Redis adapter tests. */
export interface BucketReference {
  /** Human-readable description used to identify the reference test. */
  readonly name: string;
  /** Fixed capacity, refill rate, and request cost applied throughout the sequence. */
  readonly policy: Policy;
  /** Ordered request batches and their expected results for an isolated bucket. */
  readonly steps: readonly {
    /** Clock time in milliseconds at which every request in this batch occurs. */
    readonly atMs: number;
    /** Number of consecutive requests to consume at this timestamp. */
    readonly calls: number;
    /** Expected admission outcome for every request in the batch. */
    readonly allowed: boolean;
    /** Expected fractional balance after the final request in the batch. */
    readonly tokens: number;
    /** Expected milliseconds until one token is available after the final request. */
    readonly retryAfterMs: number;
  }[];
}

export const bucketReferences: readonly BucketReference[] = [
  {
    name: 'fractional denials persist until a complete token is earned',
    policy: { capacity: 100, refillPerMinute: 100, requestCost: 1 },
    steps: [
      { atMs: 0, calls: 25, allowed: true, tokens: 0, retryAfterMs: 600 },
      { atMs: 0, calls: 1, allowed: false, tokens: 0, retryAfterMs: 600 },
      { atMs: 150, calls: 1, allowed: false, tokens: 0.25, retryAfterMs: 450 },
      { atMs: 300, calls: 1, allowed: false, tokens: 0.5, retryAfterMs: 300 },
      { atMs: 600, calls: 1, allowed: true, tokens: 0, retryAfterMs: 600 },
      { atMs: 120_600, calls: 1, allowed: true, tokens: 99, retryAfterMs: 0 },
    ],
  },
  {
    name: 'independent capacity and refill policy',
    policy: { capacity: 10, refillPerMinute: 60, requestCost: 1 },
    steps: [
      { atMs: 0, calls: 3, allowed: true, tokens: 0, retryAfterMs: 1000 },
      { atMs: 500, calls: 1, allowed: false, tokens: 0.5, retryAfterMs: 500 },
      { atMs: 1000, calls: 1, allowed: true, tokens: 0, retryAfterMs: 1000 },
      { atMs: 60_000, calls: 1, allowed: true, tokens: 9, retryAfterMs: 0 },
    ],
  },
  {
    name: 'capacity one still starts with one local token',
    policy: { capacity: 1, refillPerMinute: 120, requestCost: 1 },
    steps: [
      { atMs: 0, calls: 1, allowed: true, tokens: 0, retryAfterMs: 500 },
      { atMs: 0, calls: 1, allowed: false, tokens: 0, retryAfterMs: 500 },
      { atMs: 500, calls: 1, allowed: true, tokens: 0, retryAfterMs: 500 },
    ],
  },
];
