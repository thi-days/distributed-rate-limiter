import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';
import { createClient } from 'redis';

// Run against the documented local Compose demo; only its two known counters are reset.
test(
  'Nginx distributes requests while all three APIs enforce one shared limit',
  { timeout: 15_000 },
  async t => {
    const admin = createClient({
      url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      socket: { reconnectStrategy: false, connectTimeout: 1000 },
    });
    admin.on('error', () => {});

    // Reset only the two known demo counters, never the whole Redis database.
    const keys = ['demo-client', 'demo-client-custom'].map(
      key =>
        `rate-limiter:window:${createHash('sha256').update(key).digest('hex')}`,
    );
    t.after(async () => {
      try {
        if (admin.isReady) await admin.del(keys);
      } finally {
        if (admin.isOpen) admin.destroy();
      }
    });
    await admin.connect();
    await admin.del(keys);

    // Go through Nginx so the real load balancer participates in the check.
    const responses = await Promise.all(
      Array.from({ length: 15 }, async () => {
        const response = await fetch('http://127.0.0.1:8080/api/resource', {
          headers: { 'X-API-Key': 'demo-client' },
          signal: AbortSignal.timeout(3000),
        });
        await response.text();
        return response;
      }),
    );

    // Print actual observations for live demos; assertions still decide pass or fail.
    const accepted = responses.filter(({ status }) => status === 200).length;
    const rejected = responses.filter(({ status }) => status === 429).length;
    const instanceIds = [
      ...new Set(responses.map(({ headers }) => headers.get('x-instance-id'))),
    ];
    t.diagnostic(`Instances: ${instanceIds.sort().join(', ')}`);
    t.diagnostic(
      `Shared limit: 10 | Sent: ${responses.length} | Accepted: ${accepted} | Rejected: ${rejected}`,
    );

    assert.equal(accepted, 10);
    assert.equal(rejected, 5);
    assert.equal(instanceIds.length, 3);
    for (const response of responses) {
      assert.match(response.headers.get('ratelimit-policy') ?? '', /q=10/);
      if (response.status === 429)
        assert.ok(Number(response.headers.get('retry-after')) > 0);
    }

    // Bypassing Nginx must not grant another allowance on any backend.
    for (const port of [3001, 3002, 3003]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/resource`, {
        headers: { 'X-API-Key': 'demo-client' },
        signal: AbortSignal.timeout(3000),
      });
      await response.text();
      t.diagnostic(`Direct API on port ${port}: HTTP ${response.status}`);
      assert.equal(response.status, 429);
    }

    // A different registered client keeps its own untouched allowance.
    const independent = await fetch('http://127.0.0.1:8080/api/resource', {
      headers: { 'X-API-Key': 'demo-client-custom' },
      signal: AbortSignal.timeout(3000),
    });
    await independent.text();
    t.diagnostic(`Independent key: HTTP ${independent.status}`);
    assert.equal(independent.status, 200);
    assert.match(independent.headers.get('ratelimit-policy') ?? '', /q=10/);
  },
);

// Compare the proxy and direct paths with actual duplicate header fields.
for (const port of [8080, 3001]) {
  test(
    `port ${port} rejects actual mixed-case duplicate key fields`,
    { timeout: 5000 },
    async () => {
      // Raw Node headers avoid merging duplicate fields before they reach the server.
      const response = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const req = request(
            {
              host: '127.0.0.1',
              port,
              path: '/api/resource',
              agent: false,
              headers: [
                'Host',
                'localhost',
                'X-API-Key',
                'demo-client',
                'x-API-key',
                'demo-client',
              ],
              signal: AbortSignal.timeout(3000),
            },
            res => {
              let body = '';
              res.on('data', (chunk: Buffer) => {
                body += chunk.toString();
              });
              res.on('error', reject);
              res.on('end', () => resolve({ status: res.statusCode!, body }));
            },
          );
          req.on('error', reject);
          req.end();
        },
      );

      // Both paths must preserve the API's invalid-key response.
      assert.equal(response.status, 400);
      assert.deepEqual(JSON.parse(response.body), {
        error: { code: 'INVALID_API_KEY' },
      });
    },
  );
}
