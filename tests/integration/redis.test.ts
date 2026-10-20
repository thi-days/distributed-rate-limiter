import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from 'redis';

test('real Redis responds to PING', { timeout: 10_000 }, async () => {
  const client = createClient({
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  // Connection errors are reported through the actionable failure below.
  client.on('error', () => {});

  try {
    await client.connect();
    assert.equal(await client.ping(), 'PONG');
  } catch {
    throw new Error(
      'Redis integration check failed. Start real Redis with: docker compose up -d redis; then rerun npm run test:integration. Set REDIS_URL if Redis uses another address.',
    );
  } finally {
    if (client.isOpen) client.destroy();
  }
});
