import type { Server } from 'node:http';
import { loadConfiguration } from './config.js';
import { createApplication } from './http/app.js';
import { LocalBucketStore } from './stores/local-bucket-store.js';
import { RateLimiter } from './rate-limiter.js';
import { RedisBucketStore } from './stores/redis/redis-bucket-store.js';

/** Stop accepting requests, allowing up to 10 seconds for active connections. */
export function closeHttpServer(server: Server, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, timeoutMs);

    server.close(() => {
      clearTimeout(deadline);
      resolve();
    });
  });
}

function main(): void {
  // Read startup settings before creating stores or opening the HTTP port.
  const configuration = loadConfiguration();
  const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');

  // Keep one local store for the process lifetime, across all outages.
  const redisStore = new RedisBucketStore(configuration);
  const localStore = new LocalBucketStore(configuration);
  const rateLimiter = new RateLimiter(configuration, redisStore, localStore);

  // Build the routes and start the conventional Express listener.
  const app = createApplication({
    configuration,
    bucketStore: rateLimiter,
    instanceId: process.env.INSTANCE_ID ?? 'api-1',
  });
  const server = app.listen(port, () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`HTTP server listening on port ${address.port}`);
  });

  // On shutdown, stop recovery, finish active HTTP requests, then close Redis.
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    // Stop background probes first, but leave stores usable for requests still being drained.
    rateLimiter.stopRecovery();
    await closeHttpServer(server);
    rateLimiter.close();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Release resources if the HTTP listener cannot start.
  server.on('error', () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    rateLimiter.close();
    console.error('Unable to start HTTP server');
    process.exitCode = 1;
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to run HTTP server');
    process.exitCode = 1;
  }
}
