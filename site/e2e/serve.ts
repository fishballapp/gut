// The built site (`dist/`), served as its Worker serves it, for the e2e: `/` is index.html and
// `/name` is name.html (`build.format: 'file'`). Not `astro preview`, which runs itself in the
// background when it detects a coding agent, out of the test runner's reach.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const candidatesOf = (pathname: string) => {
  const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) return [join(path, 'index.html')];
  return extname(path) === '' ? [`${path}.html`, join(path, 'index.html')] : [path];
};

const [port = '4329'] = process.argv.slice(2);
createServer(async (request, response) => {
  for (const candidate of candidatesOf(new URL(request.url ?? '/', 'http://localhost').pathname)) {
    try {
      const body = await readFile(join(DIST, candidate));
      response.writeHead(200, {
        'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream',
      });
      response.end(body);
      return;
    } catch {}
  }
  response.writeHead(404).end();
}).listen(Number(port));
