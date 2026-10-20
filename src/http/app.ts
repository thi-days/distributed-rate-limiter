import express, { type RequestHandler } from 'express';
import type { Configuration } from '../config.js';
import { createApiKeyMiddleware } from './api-key-middleware.js';
import { createRateLimitMiddleware, type BucketStore } from './rate-limit-middleware.js';
import { jsonErrorHandler } from './error-handler.js';

export interface ApplicationDependencies {
  /** Immutable registry used before any store access. */
  readonly configuration: Pick<Configuration, 'policyFor'>;
  /** Make exactly one consumption attempt for a registered, validated key. */
  readonly bucketStore: BucketStore;
  /** Safe public instance label, exposed as X-Instance-ID. */
  readonly instanceId: string;
  /** Demonstration handler; injectable to verify allowance and error propagation. */
  readonly resourceHandler?: RequestHandler;
}

/** Construct without listening, opening Redis, or installing process handlers. */
export function createApplication(dependencies: ApplicationDependencies) {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(dependencies.instanceId)) throw new Error('Invalid instance ID');

  const app = express();
  app.disable('x-powered-by');
  app.use(function identifyInstance(_req, res, next) {
    res.setHeader('X-Instance-ID', dependencies.instanceId);
    next();
  });
  const healthHandler: RequestHandler = (_req, res) => { res.json({ message: 'ok' }); };
  const resourceHandler: RequestHandler = (_req, res) => { res.json({ message: 'ok' }); };

  app.get('/health', healthHandler);

  const identifyClient = createApiKeyMiddleware(dependencies.configuration);
  const rateLimit = createRateLimitMiddleware(dependencies.bucketStore);

  app.get(
    '/api/resource',
    identifyClient,
    rateLimit,
    dependencies.resourceHandler ?? resourceHandler,
  );
  app.use(jsonErrorHandler);

  return app;
}
