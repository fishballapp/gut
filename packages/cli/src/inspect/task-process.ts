// Runs a task in its own process, forked from the CLI with the same `gut run` command, so each run
// loads the task's code fresh and a restart can kill it. The task's inspector hooks are the session's,
// reached over IPC: attaching a run and its events are messages, each answer the task waits on is a
// call the session answers under the same id (`child.ts` is the task's side).
import { fork } from 'node:child_process';
import type { RunHooks } from '@gut.run/core/inspector';
import { z } from 'zod';
import {
  type CallHook,
  type CallMessage,
  CHILD_ENV,
  type HookResults,
  TaskMessageSchema,
} from './ipc.ts';
import type { TaskLink, TaskProcess } from './session.ts';

/** How long a stopped task has to exit after SIGTERM before it is killed. */
const GRACE_MS = 1000;

const runHook = (hooks: RunHooks, call: CallMessage): Promise<HookResults[CallHook]> => {
  switch (call.hook) {
    case 'answer':
      return hooks.answer(call.arg);
    case 'beforePick':
      return hooks.beforePick(call.arg);
    case 'beforeInvoke':
      return hooks.beforeInvoke(call.arg);
  }
};

export const forkTask = ({
  entry,
  file,
  args,
  link,
  warn,
}: {
  /** The CLI's own entry: the task runs in a child `gut run`. */
  entry: string;
  file: string;
  args: string[];
  link: TaskLink;
  warn: (message: string) => void;
}): TaskProcess => {
  const child = fork(entry, ['run', '--', file, ...args], {
    env: { ...process.env, [CHILD_ENV]: '1' },
    execArgv: process.execArgv,
  });
  const hooksByRun = new Map<string, RunHooks>();
  let hasEnded = false;

  // A process ends once: its own `end`, or its exit, whichever the CLI hears first.
  const end = (error?: string) => {
    if (hasEnded) return;
    hasEnded = true;
    link.end(error);
  };

  const reply = (id: number, value: HookResults[CallHook]) => {
    if (child.connected) child.send({ kind: 'result', id, value });
  };

  child.on('message', message => {
    const parsed = TaskMessageSchema.safeParse(message);
    if (!parsed.success) {
      warn(`gut inspector: dropped a message the task sent: ${z.prettifyError(parsed.error)}`);
      return;
    }
    const msg = parsed.data;
    switch (msg.kind) {
      case 'attach':
        hooksByRun.set(msg.runId, link.attach({ runId: msg.runId }));
        return;
      case 'event':
        hooksByRun.get(msg.event.runId)?.onEvent(msg.event);
        return;
      case 'call': {
        const hooks = hooksByRun.get(msg.runId);
        if (hooks === undefined) {
          warn(`gut inspector: the task asked for a ${msg.hook} of a run it never attached`);
          return;
        }
        void runHook(hooks, msg).then(value => reply(msg.id, value));
        return;
      }
      case 'end':
        end(msg.error);
        return;
    }
  });
  // A task that exits without saying so (`process.exit`, a crash) still ends the session.
  child.on('error', error => end(error.message));
  child.on('exit', (code, signal) =>
    end(`the task's process stopped (${signal ?? `code ${code}`}) before it finished`),
  );

  return {
    stop: () =>
      new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const kill = setTimeout(() => child.kill('SIGKILL'), GRACE_MS);
        child.once('exit', () => {
          clearTimeout(kill);
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
};
