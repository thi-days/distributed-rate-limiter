import { createHash } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { rateLimit, type Store } from 'express-rate-limit';
import { policies, windowMs } from '../config.js';
import { jsonErrorHandler } from './error-handler.js';

export interface ApplicationOptions {
  /** Shared Redis store, or a substitute for isolated tests. */
  readonly store: Store;
  /** Public instance label shown in responses for the distribution experiment. */
  readonly instanceId: string;
  /** Registered keys and maximum requests per window. */
  readonly clients?: ReadonlyMap<string, number>;
}

interface ClientContext {
  /** Validated API key; values remain case-sensitive. */
  apiKey: string;
  /** Maximum requests in the current one-minute window. */
  limit: number;
}

type ClientMiddleware = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, string>,
  ClientContext
>;

/** Build the routes without opening connections or listening on a port. */
export function createApplication({
  store,
  instanceId,
  clients = policies,
}: ApplicationOptions) {
  // This public label is returned in headers, so accept only safe characters.
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(instanceId))
    throw new Error('Invalid instance ID');

  // Identify the serving instance on every response for the distribution demo.
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Instance-ID', instanceId);
    next();
  });

  // Health stays reachable without a key, even while Redis is unavailable.
  app.get('/health', (_req, res) => {
    res.json({ message: 'ok' });
  });

  // The libraries manage shared counting, window expiry, and response headers.
  const limiter = rateLimit({
    windowMs,
    store,
    // All instances use the same key without storing the raw API key in Redis.
    keyGenerator: (_req, res) =>
      createHash('sha256')
        .update((res.locals as ClientContext).apiKey)
        .digest('hex'),
    limit: (_req, res) => (res.locals as ClientContext).limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Continue serving on store errors, temporarily giving up rate-limit protection.
    passOnStoreError: true,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED' } },
    // Store errors may contain credentials; log only the library's explanation.
    logger: {
      error: (_error, message) =>
        console.error(message ?? 'Rate limiter error'),
      warn: (_error, message) =>
        console.warn(message ?? 'Rate limiter warning'),
    },
  });

  // Resolve the client and its policy before the limiter can access the store.
  const identifyClient: ClientMiddleware = (req, res, next) => {
    // Raw headers alternate names and values and preserve duplicate fields.
    let keyFields = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === 'x-api-key') keyFields++;
    }

    const apiKey = req.headers['x-api-key'];
    if (
      keyFields !== 1 ||
      typeof apiKey !== 'string' ||
      !/^[^\s]+$/u.test(apiKey)
    ) {
      res.status(400).json({ error: { code: 'INVALID_API_KEY' } });
      return;
    }

    // A well-formed key still needs to belong to a registered demo client.
    const limit = clients.get(apiKey);
    if (limit === undefined) {
      res.status(403).json({ error: { code: 'UNKNOWN_API_KEY' } });
      return;
    }

    // Share only validated values with the following middleware for this request.
    res.locals.apiKey = apiKey;
    res.locals.limit = limit;
    next();
  };

  // Request flow: identify the client, check its allowance, then serve the resource.
  app.get('/api/resource', identifyClient, limiter, (_req, res) => {
    res.json({ message: 'ok' });
  });

  // Register last so route failures reach the JSON error handler.
  app.use(jsonErrorHandler);

  return app;
}
