import { once } from 'node:events';
import { request, type Server } from 'node:http';
import type { Express } from 'express';
import type { TestContext } from 'node:test';
import { closeHttpServer } from '../../src/main.js';

/** Start an isolated local server and register its cleanup with the test runner. */
export async function serve(t: TestContext, app: Express) {
  // Port zero lets the OS choose a free port, so tests can run side by side.
  const server = app.listen(0, '127.0.0.1');
  t.after(() => closeHttpServer(server));

  // Return only after requests can reach the server.
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server not listening');

  return server;
}

/** Send a real GET request and return its status, headers, and unparsed body. */
export function get(
  server: Server,
  path = '/api/resource',
  headers = ['X-API-Key', 'demo-client'],
) {
  // Read the allocated TCP port instead of relying on a fixed test address.
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server not listening');

  return new Promise<{
    status: number;
    headers: import('node:http').IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: address.port,
        path,
        // Raw pairs preserve duplicates; disable connection reuse for easy cleanup.
        headers: ['Host', 'localhost', 'Connection', 'close', ...headers],
        agent: false,
      },
      res => {
        // Resolve after the complete body arrives, not just the response headers.
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('error', reject);
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );

    // Reject connection failures too, and finish sending the body-free request.
    req.on('error', reject);
    req.end();
  });
}
