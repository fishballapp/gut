import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureOracle, type FixtureOracle, type LayoutName } from './oracle.ts';

export type FixtureServer = {
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
  readonly oracle: FixtureOracle;
  readonly close: () => Promise<void>;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const htmlDir = join(currentDir, 'html');

export const createFixtureServer = async (): Promise<FixtureServer> => {
  const oracle = createFixtureOracle();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    const serveHtml = async (filePath: string): Promise<void> => {
      try {
        const content = await readFile(join(htmlDir, filePath), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    };

    // --- DOCS ---
    if (path === '/docs/layout-a' || path === '/docs/layout-a/') {
      return serveHtml('docs/layout-a/index.html');
    }
    if (path === '/docs/layout-a/api-reference') {
      return serveHtml('docs/layout-a/api-reference.html');
    }
    if (path === '/docs/layout-a/rate-limits') {
      return serveHtml('docs/layout-a/rate-limits.html');
    }
    if (path.startsWith('/docs/layout-a/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!DOCTYPE html><html><body><h1>Doc Page</h1><a href="/docs/layout-a">Back</a></body></html>',
      );
      return;
    }

    if (path === '/docs/layout-b' || path === '/docs/layout-b/') {
      return serveHtml('docs/layout-b/index.html');
    }
    if (path === '/docs/layout-b/quotas') {
      return serveHtml('docs/layout-b/quotas.html');
    }
    if (path === '/docs/layout-b/rate-limits') {
      return serveHtml('docs/layout-b/rate-limits.html');
    }
    if (path.startsWith('/docs/layout-b/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!DOCTYPE html><html><body><h1>Doc Page</h1><a href="/docs/layout-b">Back</a></body></html>',
      );
      return;
    }

    // --- DIRECTORY ---
    if (path === '/directory/layout-a' || path === '/directory/layout-a/') {
      return serveHtml('directory/layout-a.html');
    }
    if (path === '/directory/layout-b' || path === '/directory/layout-b/') {
      return serveHtml('directory/layout-b.html');
    }
    if (path === '/directory/layout-a/manchester' || path === '/directory/layout-b/manchester') {
      return serveHtml('directory/manchester.html');
    }
    if (path.startsWith('/directory/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>Office Page</h1></body></html>');
      return;
    }

    // --- FORM ---
    if (path === '/form/layout-a' || path === '/form/layout-a/') {
      return serveHtml('form/layout-a.html');
    }
    if (path === '/form/layout-b' || path === '/form/layout-b/') {
      return serveHtml('form/layout-b.html');
    }
    if (path.startsWith('/form/') && path.endsWith('/search') && req.method === 'POST') {
      const layout: LayoutName = path.includes('layout-a') ? 'layout-a' : 'layout-b';
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const destination = params.get('destination') ?? '';
        const date = params.get('date') ?? '';
        oracle.form[layout] = { destination, date };
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          `<!DOCTYPE html><html><head><title>Search Confirmation</title></head><body><h1>Search Results</h1><p>Destination: ${destination}</p><p>Date: ${date}</p></body></html>`,
        );
      });
      return;
    }

    // --- DELAYED ---
    if (path === '/delayed/layout-a' || path === '/delayed/layout-a/') {
      return serveHtml('delayed/layout-a.html');
    }
    if (path === '/delayed/layout-b' || path === '/delayed/layout-b/') {
      return serveHtml('delayed/layout-b.html');
    }
    if (path.startsWith('/delayed/') && path.endsWith('/complete') && req.method === 'POST') {
      const layout: LayoutName = path.includes('layout-a') ? 'layout-a' : 'layout-b';
      oracle.delayed[layout] = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Failed to get server port');
  }
  const port = addr.port;
  const origin = `http://127.0.0.1:${port}`;

  return {
    server,
    port,
    origin,
    oracle,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
};
