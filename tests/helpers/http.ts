import { once } from 'node:events';
import { request, type Server } from 'node:http';
import type { Express } from 'express';
import type { TestContext } from 'node:test';
import { closeHttpServer } from '../../src/main.js';

export async function serve(t: TestContext, app: Express) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => closeHttpServer(server));
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Server not listening');

  return server;
}

export function get(
  server: Server,
  path = '/api/resource',
  headers = ['X-API-Key', 'demo-client'],
) {
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
        headers: ['Host', 'localhost', 'Connection', 'close', ...headers],
        agent: false,
      },
      res => {
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
    req.on('error', reject);
    req.end();
  });
}
