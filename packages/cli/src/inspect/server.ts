// The inspector's local server: the page's files, the event stream (SSE, replayed from the start or
// from Last-Event-ID) and the page's actions. 127.0.0.1 only; every /api request carries the token
// from the printed URL, and the Host header must name this server, against DNS rebinding.
import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { type Action, ActionSchema } from '@gut.run/core/inspector';
import { z } from 'zod';
import type { EventLog } from './log.ts';
import type { ActResult } from './session.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** The most an action body may hold: a model's endpoint and key, or a turn's answers. */
const MAX_BODY_BYTES = 64 * 1024;

/** Whether `given` is the token, in constant time; byte lengths differ before characters do. */
const isSame = (given: string | null | undefined, token: string) => {
  if (typeof given !== 'string') return false;
  const givenBytes = Buffer.from(given);
  const tokenBytes = Buffer.from(token);
  return givenBytes.length === tokenBytes.length && timingSafeEqual(givenBytes, tokenBytes);
};

const readBody = (req: IncomingMessage) =>
  new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

/** The port a listening server is on. */
const portOf = (server: Server) => {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the inspector server is not listening on a TCP port');
  }
  return address.port;
};

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

const send = (res: ServerResponse, status: number, body?: string) => {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
  res.end(body);
};

/**
 * Streams the log to one client from `cursor`. Writes until the socket's buffer is full, then
 * waits for `drain`, so a stalled tab holds only its own cursor and never slows the run.
 */
const streamEvents = (req: IncomingMessage, res: ServerResponse, log: EventLog, cursor: number) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  let next = cursor;
  let isDraining = false;
  const pump = () => {
    if (isDraining) return;
    // A restart cleared what this client had not read yet: it resumes at the first event kept.
    next = Math.max(next, log.firstId());
    for (let event = log.at(next); event !== undefined; event = log.at(next)) {
      const isWritable = res.write(`id: ${next}\ndata: ${JSON.stringify(event)}\n\n`);
      next += 1;
      if (!isWritable) {
        isDraining = true;
        res.once('drain', () => {
          isDraining = false;
          pump();
        });
        return;
      }
    }
  };
  const unsubscribe = log.subscribe(pump);
  req.on('close', unsubscribe);
  pump();
};

/** Serves a file under `root`, `index.html` for `/`; never a path outside it. */
const serveFile = async (res: ServerResponse, root: string, pathname: string) => {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return undefined;
    }
  })();
  if (decoded === undefined) return send(res, 400);
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const path = join(root, relative === '' ? 'index.html' : relative);
  if (path !== root && !path.startsWith(root + sep)) return send(res, 404);
  const isFile = await stat(path).then(
    info => info.isFile(),
    () => false,
  );
  if (!isFile) return send(res, 404);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
  });
  res.end(await readFile(path));
};

export const startServer = async ({
  log,
  act,
  root,
  port,
  token,
}: {
  log: EventLog;
  act: (action: Action) => Promise<ActResult>;
  /** The built page: `@gut.run/inspector`'s dist. */
  root: string;
  /** 0 picks a free port. */
  port: number;
  token: string;
}) => {
  const server = createServer((req, res) => {
    const actual = portOf(server);
    const host = req.headers.host;
    if (host !== `127.0.0.1:${actual}` && host !== `localhost:${actual}`) return send(res, 403);
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (url.pathname === '/api/events' && req.method === 'GET') {
      if (!isSame(url.searchParams.get('token'), token)) return send(res, 403);
      const lastId = Number(req.headers['last-event-id']);
      return streamEvents(req, res, log, Number.isInteger(lastId) ? lastId + 1 : 0);
    }

    if (url.pathname === '/api/actions') {
      if (req.method !== 'POST') return send(res, 405);
      const given = req.headers['x-gut-token'];
      if (!isSame(Array.isArray(given) ? given[0] : given, token)) return send(res, 403);
      void readBody(req).then(async body => {
        if (body === undefined) return send(res, 413);
        const json = parseJson(body);
        if (!json.ok) return send(res, 400, JSON.stringify({ error: 'the body is not JSON' }));
        const action = ActionSchema.safeParse(json.value);
        if (!action.success) {
          return send(res, 400, JSON.stringify({ error: z.prettifyError(action.error) }));
        }
        const result = await act(action.data);
        return 'error' in result
          ? send(res, result.status, JSON.stringify({ error: result.error }))
          : send(res, 204);
      });
      return;
    }

    if (req.method !== 'GET') return send(res, 405);
    void serveFile(res, root, url.pathname);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${portOf(server)}/?token=${token}`,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
