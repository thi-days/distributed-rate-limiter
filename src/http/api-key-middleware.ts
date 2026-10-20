import type { Configuration } from '../config.js';
import type { ResourceMiddleware } from './context.js';

export function createApiKeyMiddleware(configuration: Pick<Configuration, 'policyFor'>): ResourceMiddleware {
  const identifyClient: ResourceMiddleware = (req, res, next) => {
    let apiKeyFieldCount = 0;
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === 'x-api-key') apiKeyFieldCount++;
    }

    const apiKey = req.headers['x-api-key'];
    if (apiKeyFieldCount !== 1 || typeof apiKey !== 'string' || !/^[^\s]+$/u.test(apiKey)) {
      res.status(400).json({ error: { code: 'INVALID_API_KEY' } });
      return;
    }

    const policy = configuration.policyFor(apiKey);
    if (policy === undefined) {
      res.status(403).json({ error: { code: 'UNKNOWN_API_KEY' } });
      return;
    }

    res.locals.apiKey = apiKey;
    res.locals.policy = policy;
    next();
  };

  return identifyClient;
}
