// `gut run --inspect`: serves the inspector, and runs the task in a process of its own (forked by
// `task-process.ts`), which a restart from the page replaces. The record stays served after the task
// ends, until the process is stopped.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@gut.run/core';
import type { DecisionModel } from '@gut.run/core/inspector';
import { createEventLog } from './log.ts';
import { inspectorRoot } from './page-root.ts';
import { startServer } from './server.ts';
import { createSession } from './session.ts';
import { forkTask } from './task-process.ts';

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

/** A gut config's model, for the page, read from a path (`~/` is home). */
const readConfigModel = async (path: string): Promise<DecisionModel> => {
  const resolved = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  return (await loadConfig({ configJsonPath: resolved })).decisionModel;
};

const say = (line: string) => {
  process.stderr.write(`${line}\n`);
};

export const runInspected = async (
  file: string,
  args: string[],
  { entry, port, open }: { entry: string; port: number; open: boolean },
) => {
  const root = inspectorRoot();
  const log = createEventLog();
  const session = createSession({
    task: file,
    emit: log.append,
    clear: log.clear,
    warn: say,
    readConfig: readConfigModel,
    start: link => forkTask({ entry, file, args, link, warn: say }),
  });
  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({
      log,
      act: session.act,
      root,
      port,
      token: randomBytes(18).toString('base64url'),
    });
  } catch (error) {
    // The task has been forked already: stop it, so a port that's taken leaves nothing running.
    await session.stop();
    throw error;
  }
  say(`gut inspector: ${server.url}`);
  if (open && process.stdout.isTTY) openInBrowser(server.url);

  // The task's process would get the terminal's Ctrl-C too, but it is stopped here as well, so the
  // CLI never leaves one running behind it.
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      void session.stop().then(() => process.exit(code));
    });
  }
};
