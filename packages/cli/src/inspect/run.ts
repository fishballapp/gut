// `gut run --inspect`: serves the inspector, attaches it to every run the task starts, then imports
// the task. The record stays served after the task ends, until the process is stopped.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseConfig } from '@gut.run/core';
import {
  type DecisionModel,
  INSPECTOR_KEY,
  type InspectorGlobal,
  PROTOCOL,
} from '@gut.run/core/inspector';
import { createEventLog } from './log.ts';
import { startServer } from './server.ts';
import { type ConfigFrom, createSession } from './session.ts';

/** The built page's directory, from `@gut.run/inspector`, the same from source and from npm. */
const inspectorRoot = () => {
  const index = (() => {
    try {
      return fileURLToPath(import.meta.resolve('@gut.run/inspector/index.html'));
    } catch {
      return undefined;
    }
  })();
  if (index === undefined || !existsSync(index)) {
    throw new Error(
      "gut inspector: the page isn't built. In the gut repo: pnpm -F @gut.run/inspector build",
    );
  }
  return dirname(index);
};

/** How each platform opens a URL in the default browser. */
const openerFor = (url: string): [string, ...string[]] => {
  if (process.platform === 'darwin') return ['open', url];
  if (process.platform === 'win32') return ['cmd', '/c', 'start', '', url];
  return ['xdg-open', url];
};

const openInBrowser = (url: string) => {
  const [command, ...args] = openerFor(url);
  // A missing opener is not worth stopping the run for: the URL is printed.
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
};

/** A gut config's model, for the page: a path (`~/` is home) or a file's text the page read. */
const readConfigModel = async (from: ConfigFrom): Promise<DecisionModel> => {
  if (from.kind === 'text') return parseConfig(from.text, 'the chosen file').decisionModel;
  const path = from.path.startsWith('~/') ? join(homedir(), from.path.slice(2)) : from.path;
  return (await loadConfig({ configJsonPath: path })).decisionModel;
};

const say = (line: string) => {
  process.stderr.write(`${line}\n`);
};

export const runInspected = async (
  file: string,
  taskUrl: string,
  { port, open }: { port: number; open: boolean },
) => {
  const root = inspectorRoot();
  const log = createEventLog();
  const session = createSession({
    task: file,
    emit: log.append,
    warn: say,
    readConfig: readConfigModel,
  });
  const server = await startServer({
    log,
    act: session.act,
    root,
    port,
    token: randomBytes(18).toString('base64url'),
  });
  say(`gut inspector: ${server.url}`);
  if (open && process.stdout.isTTY) openInBrowser(server.url);

  const inspector: InspectorGlobal = { protocol: PROTOCOL, attach: session.attach };
  Reflect.set(globalThis, INSPECTOR_KEY, inspector);
  try {
    await import(taskUrl);
    session.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    session.end(message);
    say(`the task threw: ${message}`);
  }
  if (!session.hasAttached()) {
    say(
      'No run attached: the task never called runTask, or its @gut.run/core predates the inspector.',
    );
  }
  say(`The task ended; the inspector stays at ${server.url} until Ctrl-C.`);
};
