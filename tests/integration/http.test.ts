import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import { before, test, type TestContext } from 'node:test';
import { createClient } from 'redis';
import { createApplication } from '../../src/http/app.js';
import { createRedisStore } from '../../src/redis.js';
import { get, serve } from '../helpers/http.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

before(async () => {
  const client = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: false, connectTimeout: 1000 },
  });
  client.on('error', () => {});
  try {
    await client.connect();
    await client.ping();
  } catch {
    throw new Error(
      'Start Redis with docker compose up -d redis, or set REDIS_URL, then rerun npm run test:integration.',
    );
  } finally {
    if (client.isOpen) client.destroy();
  }
});

test(
  'three instances share one allowance and keep other keys independent',
  { timeout: 10_000 },
  async t => {
    const prefix = `test:${randomUUID()}:`;
    const clients = new Map([
      ['demo-client', 10],
      ['custom', 5],
    ]);
    const connections = Array.from({ length: 3 }, () =>
      createRedisStore(redisUrl, prefix),
    );
    for (const { client } of connections)
      t.after(async () => {
        try {
          if (client.isReady)
            await client.del(
              [...clients.keys()].map(
                key => prefix + createHash('sha256').update(key).digest('hex'),
              ),
            );
        } finally {
          if (client.isOpen) client.destroy();
        }
      });
    await Promise.all(connections.map(({ client }) => client.connect()));
    const servers = await Promise.all(
      connections.map(({ store }, index) =>
        serve(
          t,
          createApplication({ store, clients, instanceId: `api-${index + 1}` }),
        ),
      ),
    );

    const responses = await Promise.all(
      Array.from({ length: 15 }, (_, index) => get(servers[index % 3]!)),
    );

    const accepted = responses.filter(({ status }) => status === 200).length;
    const rejected = responses.filter(({ status }) => status === 429).length;
    const instanceIds = [
      ...new Set(responses.map(({ headers }) => headers['x-instance-id'])),
    ];
    t.diagnostic(`Instances: ${instanceIds.sort().join(', ')}`);
    t.diagnostic(
      `Shared limit: 10 | Sent: ${responses.length} | Accepted: ${accepted} | Rejected: ${rejected}`,
    );

    assert.equal(accepted, 10);
    assert.equal(rejected, 5);
    assert.equal(instanceIds.length, 3);
    for (const response of responses) {
      assert.match(String(response.headers['ratelimit-policy']), /q=10/);
      if (response.status === 429)
        assert.ok(Number(response.headers['retry-after']) > 0);
    }
    assert.equal(
      (await get(servers[0]!, '/api/resource', ['X-API-Key', 'custom'])).status,
      200,
    );
  },
);

/** A local TCP forwarder lets each failure test interrupt only its own Redis connection. */
async function redisProxy(t: TestContext, initiallyOnline: boolean) {
  const target = new URL(redisUrl);
  const upstreamAddress = {
    host: target.hostname,
    port: Number(target.port || 6379),
  };
  let online = initiallyOnline;
  const sockets = new Set<Socket>();
  const proxy = createServer(incoming => {
    if (!online) {
      incoming.destroy();
      return;
    }
    const upstream = createConnection(upstreamAddress);
    for (const socket of [incoming, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {
        incoming.destroy();
        upstream.destroy();
      });
      socket.on('close', () => {
        sockets.delete(socket);
        incoming.destroy();
        upstream.destroy();
      });
    }
    incoming.pipe(upstream).pipe(incoming);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const address = proxy.address();
  assert.ok(address && typeof address !== 'string');
  target.hostname = '127.0.0.1';
  target.port = String(address.port);

  return {
    url: target.toString(),
    setOnline(value: boolean) {
      online = value;
      if (!online) for (const socket of sockets) socket.destroy();
    },
  };
}

for (const initiallyOnline of [false, true]) {
  test(
    `${initiallyOnline ? 'runtime' : 'startup'} outage allows requests and recovery restores enforcement`,
    { timeout: 10_000 },
    async t => {
      t.mock.method(console, 'error', () => {});
      const proxy = await redisProxy(t, initiallyOnline);
      const prefix = `test:${randomUUID()}:`;
      const { client, store } = createRedisStore(proxy.url, prefix);
      t.after(() => {
        if (client.isOpen) client.destroy();
      });
      const server = await serve(
        t,
        createApplication({
          store,
          clients: new Map([['demo-client', 1]]),
          instanceId: 'test',
        }),
      );
      const connecting = client.connect();
      // Register rejection handling immediately, including cleanup after a failed assertion.
      void connecting.catch(() => {});

      if (initiallyOnline) {
        await connecting;
        assert.equal((await get(server)).status, 200);
        assert.equal((await get(server)).status, 429);
        const disconnected = new Promise<void>(resolve => {
          client.once('reconnecting', resolve);
        });
        proxy.setOnline(false);
        await disconnected;
      }

      const responses = await Promise.all([
        get(server),
        get(server),
        get(server),
      ]);
      const withoutLimitHeaders = responses.filter(
        ({ headers }) => headers.ratelimit === undefined,
      ).length;
      t.diagnostic(
        `Redis offline: HTTP ${responses.map(({ status }) => status).join(', ')} | Without limit headers: ${withoutLimitHeaders}/${responses.length}`,
      );
      assert.ok(
        responses.every(
          ({ status, headers }) =>
            status === 200 && headers.ratelimit === undefined,
        ),
      );
      assert.equal((await get(server, '/health', [])).status, 200);

      const recovered = new Promise<void>(resolve => {
        client.once('ready', resolve);
      });
      proxy.setOnline(true);
      await recovered;
      await Promise.all([store.incrementScriptSha, store.getScriptSha]);
      if (!initiallyOnline) assert.equal((await get(server)).status, 200);
      const afterRecovery = await get(server);
      t.diagnostic(
        `Redis recovered: exhausted shared limit returns HTTP ${afterRecovery.status}`,
      );
      assert.equal(afterRecovery.status, 429);
      await client.del(
        prefix + createHash('sha256').update('demo-client').digest('hex'),
      );
    },
  );
}
