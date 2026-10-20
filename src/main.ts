import type { Server } from 'node:http';
import { loadConfiguration } from './config.js';
import { createApplication } from './http/app.js';
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
  const configuration = loadConfiguration();
  const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');

  const bucketStore = new RedisBucketStore(configuration);
  const app = createApplication({
    configuration,
    bucketStore,
    instanceId: process.env.INSTANCE_ID ?? 'api-1',
  });
  const server = app.listen(port, () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`HTTP server listening on port ${address.port}`);
  });
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    await closeHttpServer(server);
    bucketStore.close();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('error', () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    bucketStore.close();
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
