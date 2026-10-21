import type { Server } from 'node:http';
import { createApplication } from './http/app.js';
import { createRedisStore } from './redis.js';

/** Stop accepting requests, allowing up to 10 seconds for active connections. */
export function closeHttpServer(
  server: Server,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise(resolve => {
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
  // Reject invalid startup settings before opening any connections.
  const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid port');

  // Reuse one Redis client and store for the lifetime of this API instance.
  const { client, store } = createRedisStore();

  // Construct the HTTP routes; listening and Redis connection happen below.
  const app = createApplication({
    store,
    instanceId: process.env.INSTANCE_ID ?? 'api-1',
  });

  // Do not wait for Redis: the client reconnects in the background during outages.
  void client.connect().catch(() => {
    console.error('Unable to connect to Redis');
  });

  // Keep the server handle so shutdown can finish or close active requests.
  const server = app.listen(port, () => {
    const address = server.address();
    if (address && typeof address !== 'string')
      console.log(`HTTP server listening on port ${address.port}`);
  });

  // Repeated signals must share one shutdown sequence.
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    // Leave Redis usable until active requests finish or the drain deadline expires.
    await closeHttpServer(server);
    if (client.isOpen) client.destroy();
  }

  // Both common termination signals use the same cleanup path.
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Release resources if the HTTP listener cannot start.
  server.on('error', () => {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    if (client.isOpen) client.destroy();
    console.error('Unable to start HTTP server');
    process.exitCode = 1;
  });
}

// Importing this module for tests does not start the service.
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Unable to run HTTP server',
    );
    process.exitCode = 1;
  }
}
