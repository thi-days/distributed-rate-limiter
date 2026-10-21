import { createClient } from 'redis';
import { RedisStore } from 'rate-limit-redis';

/** Configure the native client; the caller starts and closes its connection. */
export function createRedisStore(
  url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  prefix = 'rate-limiter:window:',
) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandOptions: { timeout: 100 },
    socket: { connectTimeout: 1_000, reconnectStrategy: () => 1_000 },
  });
  client.on('error', () => {
    console.error('Redis unavailable; rate limiting may be bypassed');
  });

  const store = new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => client.sendCommand(args),
  });
  client.on('ready', () => {
    // Initialization may have failed while Redis was offline. Reload on recovery.
    store.incrementScriptSha = store.loadIncrementScript();
    store.getScriptSha = store.loadGetScript();
    void Promise.all([store.incrementScriptSha, store.getScriptSha]).catch(
      () => {
        console.error('Unable to initialize Redis rate limiting');
      },
    );
  });

  return { client, store };
}
