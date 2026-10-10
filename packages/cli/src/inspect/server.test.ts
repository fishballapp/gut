import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, InspectorEvent } from '@gut.run/core/inspector';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventLog, type EventLog } from './log.ts';
import { startServer } from './server.ts';
import type { ActResult } from './session.ts';

const TOKEN = 'test-token';

const mode = (mode: 'play' | 'step'): InspectorEvent => ({ type: 'session.mode', mode });

let root: string;
let log: EventLog;
let acted: Action[];
let result: ActResult;
let server: Awaited<ReturnType<typeof startServer>>;
let origin: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gut-inspector-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>gut</title>');
  log = createEventLog();
  acted = [];
  result = { status: 204 };
  server = await startServer({
    log,
    act: async action => {
      acted.push(action);
      return result;
    },
    root,
    port: 0,
    token: TOKEN,
  });
  origin = new URL(server.url).origin;
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true });
});

/** Reads `count` events from the stream, with their ids. */
const readEvents = async (count: number, headers: Record<string, string> = {}) => {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/events?token=${TOKEN}`, {
    headers,
    signal: controller.signal,
  });
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (reader === undefined) throw new Error('no body');
  let text = '';
  const events: { id: number; event: unknown }[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += value;
    const blocks = text.split('\n\n');
    text = blocks.pop() ?? '';
    for (const block of blocks) {
      const id = /^id: (\d+)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (id !== undefined && data !== undefined) {
        events.push({ id: Number(id), event: JSON.parse(data) });
      }
    }
  }
  controller.abort();
  return events;
};

const postAction = (body: string, token = TOKEN) =>
  fetch(`${origin}/api/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gut-token': token },
    body,
  });

/** A request with a Host header fetch won't let us set. */
const statusWithHost = (path: string, host: string) =>
  new Promise<number | undefined>((resolve, reject) => {
    const url = new URL(origin);
    httpRequest({ hostname: url.hostname, port: url.port, path, headers: { host } }, response => {
      response.resume();
      resolve(response.statusCode);
    })
      .on('error', reject)
      .end();
  });

describe('the inspector server', () => {
  it('prints a 127.0.0.1 URL carrying the token', () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=test-token$/);
  });

  it('replays the whole log to a new client, then streams what comes', async () => {
    log.append(mode('play'));
    log.append(mode('step'));
    const reading = readEvents(3);
    await new Promise(resolve => setTimeout(resolve, 50));
    log.append(mode('play'));
    expect(await reading).toEqual([
      { id: 0, event: mode('play') },
      { id: 1, event: mode('step') },
      { id: 2, event: mode('play') },
    ]);
  });

  it('resumes after Last-Event-ID', async () => {
    log.append(mode('play'));
    log.append(mode('step'));
    log.append(mode('play'));
    expect(await readEvents(1, { 'last-event-id': '1' })).toEqual([{ id: 2, event: mode('play') }]);
  });

  it('refuses the stream and actions without the token', async () => {
    expect((await fetch(`${origin}/api/events`)).status).toBe(403);
    expect((await fetch(`${origin}/api/events?token=nope`)).status).toBe(403);
    expect((await postAction('{"type":"play"}', 'nope')).status).toBe(403);
    expect(acted).toEqual([]);
  });

  it('refuses a token with as many characters but other bytes, without crashing', async () => {
    const lookalike = encodeURIComponent('é'.repeat(TOKEN.length));
    expect((await fetch(`${origin}/api/events?token=${lookalike}`)).status).toBe(403);
    expect((await postAction('{"type":"play"}', 'é'.repeat(TOKEN.length))).status).toBe(403);
  });

  it('refuses a Host that is not this server', async () => {
    expect(await statusWithHost(`/api/events?token=${TOKEN}`, 'evil.example:80')).toBe(403);
    expect(await statusWithHost('/', 'evil.example:80')).toBe(403);
    expect(await statusWithHost('/', `localhost:${new URL(origin).port}`)).toBe(200);
  });

  it('passes a valid action on, and returns what it got', async () => {
    expect((await postAction('{"type":"play"}')).status).toBe(204);
    expect(acted).toEqual([{ type: 'play' }]);
    result = { status: 409, error: 'no decision d1 is waiting' };
    const refused = await postAction('{"type":"run","decision":"d1"}');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'no decision d1 is waiting' });
  });

  it('refuses a body that is not JSON or not an action', async () => {
    expect((await postAction('not json')).status).toBe(400);
    expect((await postAction('{"type":"jump"}')).status).toBe(400);
    expect(acted).toEqual([]);
  });

  it('serves the page, and nothing outside it', async () => {
    const page = await fetch(`${origin}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect((await fetch(`${origin}/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/%E0%A4%A`)).status).toBe(400);
    expect(
      await statusWithHost('/..%2f..%2fetc%2fpasswd', `127.0.0.1:${new URL(origin).port}`),
    ).toBe(404);
  });

  it('keeps streaming to a reader while another client stops reading', async () => {
    const { port } = new URL(origin);
    // A client that asks for the stream and never reads it.
    const stalled = connect(Number(port), '127.0.0.1');
    stalled.write(`GET /api/events?token=${TOKEN} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    stalled.pause();
    await new Promise(resolve => setTimeout(resolve, 50));
    const big: InspectorEvent = { type: 'session.ended', error: 'x'.repeat(64 * 1024) };
    const count = 200; // ~13 MB, far past any socket buffer
    for (let i = 0; i < count; i++) log.append(big);
    const events = await readEvents(count);
    expect(events).toHaveLength(count);
    stalled.destroy();
  });
});
