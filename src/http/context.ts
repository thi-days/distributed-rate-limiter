import type { RequestHandler } from 'express';
import type { Policy } from '../config.js';

export interface ResourceContext {
  /** Validated, case-sensitive API key from the resource request. */
  apiKey: string;
  /** Registered policy resolved before consumption. */
  policy: Policy;
}

export type ResourceMiddleware = RequestHandler<Record<string, string>, unknown, unknown, Record<string, string>, ResourceContext>;
