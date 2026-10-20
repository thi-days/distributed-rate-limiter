import { once } from 'node:events';
import { createApplication, type ApplicationDependencies } from '../../src/http/app.js';
import type { TestContext } from 'node:test';
import { closeHttpServer } from '../../src/main.js';
import { request } from 'node:http';
import type { Server } from 'node:http';

export function get(server: Server, path = '/api/resource', headers: string[] = ['X-API-Key', 'known']) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server not listening');

  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path, headers: ['Host', '127.0.0.1', 'Connection', 'close', ...headers], agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Start an isolated application and register HTTP cleanup with the test runner. */
export async function serve(
  context: TestContext,
  dependencies: ApplicationDependencies,
) {
  const app = createApplication(dependencies);
  const server = app.listen(0);
  context.after(() => closeHttpServer(server));
  await once(server, 'listening');
  return server;
}
