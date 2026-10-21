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
  const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid port');

  const { client, store } = createRedisStore();

  // Build the routes and start the conventional Express listener.
  const app = createApplication({
    store,
    instanceId: process.env.INSTANCE_ID ?? 'api-1',
  });
  // Listen even during an outage; node-redis reconnects in the background.
  void client.connect().catch(() => {
    console.error('Unable to connect to Redis');
  });
  const server = app.listen(port, () => {
    const address = server.address();
    if (address && typeof address !== 'string')
      console.log(`HTTP server listening on port ${address.port}`);
  });

  // Finish active HTTP requests before closing Redis.
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    await closeHttpServer(server);
    if (client.isOpen) client.destroy();
  }

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
