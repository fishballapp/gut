// A real task process: forked from this CLI, its runs reach the session over IPC, and a restart
// starts the task again from its current code.

import { fork } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InspectorEvent } from '@gut.run/core/inspector';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHILD_ENV } from './ipc.ts';
import { createSession, type TaskLink } from './session.ts';
import { forkTask } from './task-process.ts';

const ENTRY = fileURLToPath(new URL('../bin/cli.ts', import.meta.url));
const CORE = import.meta.resolve('@gut.run/core');

let dir: string;
let file: string;
let events: InspectorEvent[];
let warnings: string[];
let session: ReturnType<typeof createSession>;

/** Writes the task: one run whose context carries `label`, done once its one op has run. */
const writeTask = (label: string) =>
  writeFile(
    file,
    `import { initGut, op } from ${JSON.stringify(CORE)};
const { runTask } = await initGut();
let count = 0;
await runTask(
  'Add once',
  async () => ({ context: { goal: 'Add once', label: ${JSON.stringify(label)} }, ops: { add: op('Add one', () => { count += 1; }) } }),
  { isGoalAchieved: () => count > 0 },
);
`,
  );

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** An open decision's id and what it is, or undefined when none waits. */
const openDecision = () => {
  const resolved = new Set(events.flatMap(e => (e.type === 'decision.resolved' ? [e.id] : [])));
  return events.findLast(e => e.type === 'decision.pending' && !resolved.has(e.id));
};

/** Answers whatever waits, the way a person would, until `done`; fails after 15 seconds. */
const playUntil = async (done: () => boolean) => {
  const deadline = Date.now() + 15_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out; events: ${JSON.stringify(events)}`);
    const decision = openDecision();
    if (decision?.type !== 'decision.pending') {
      await sleep(20);
      continue;
    }
    const { on } = decision;
    if (on.kind === 'step') {
      await session.act({ type: 'run', decision: decision.id });
      continue;
    }
    const turn = events.findLast(
      e => e.type === 'turn.asked' && e.runId === decision.runId && e.turn === on.turn,
    );
    if (turn?.type !== 'turn.asked') throw new Error('a turn waits with no question');
    const answers = Object.fromEntries(
      Object.entries(turn.request.questions).map(([key, question]) => [
        key,
        Object.keys(question.criteria)[0] ?? '',
      ]),
    );
    await session.act({ type: 'answer', decision: decision.id, answers });
  }
};

/** Starts the session on the task file, with a real process for each start. */
const startSession = () => {
  const links: TaskLink[] = [];
  session = createSession({
    task: file,
    emit: event => events.push(event),
    clear: () => events.splice(0),
    warn: message => warnings.push(message),
    readConfig: async () => {
      throw new Error('unused');
    },
    start: link => {
      links.push(link);
      return forkTask({ entry: ENTRY, file, args: ['5'], link, warn: m => warnings.push(m) });
    },
  });
  return links;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gut-task-process-'));
  file = join(dir, 'task.gut.ts');
  events = [];
  warnings = [];
});

afterEach(async () => {
  await session.stop();
  await rm(dir, { recursive: true });
});

describe('a task in its own process', () => {
  it('reaches the session: its runs, its questions, and its end', async () => {
    await writeTask('first');
    startSession();
    await playUntil(() => events.some(e => e.type === 'session.ended'));

    expect(events.find(e => e.type === 'run.started')).toMatchObject({ name: 'Add once' });
    expect(events.find(e => e.type === 'round.observed')).toMatchObject({
      context: { label: 'first' },
    });
    expect(events.some(e => e.type === 'run.ended')).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'session.ended' });
    expect(warnings.filter(line => line.includes('dropped'))).toEqual([]);
  }, 30_000);

  it('restarts from the task as it is now, mid-run', async () => {
    await writeTask('first');
    startSession();
    await playUntil(() => events.some(e => e.type === 'decision.pending'));

    // The task's code is edited while its run waits in Step; the restart loads the edit.
    await writeTask('second');
    await session.act({ type: 'restart' });
    expect(events.at(0)).toMatchObject({ type: 'session.started', mode: 'step' });
    await playUntil(() => events.some(e => e.type === 'round.observed'));

    expect(events.find(e => e.type === 'round.observed')).toMatchObject({
      context: { label: 'second' },
    });
    expect(events.filter(e => e.type === 'run.started')).toHaveLength(1);
  }, 30_000);

  it('restarts after the task has ended, and runs it again', async () => {
    await writeTask('first');
    startSession();
    await playUntil(() => events.some(e => e.type === 'session.ended'));

    await session.act({ type: 'restart' });
    await playUntil(() => events.some(e => e.type === 'session.ended'));

    expect(events.filter(e => e.type === 'run.ended')).toHaveLength(1);
    expect(events.filter(e => e.type === 'session.ended')).toHaveLength(1);
  }, 30_000);

  it('ends the session when the task exits on its own', async () => {
    await writeFile(file, 'process.exit(3);\n');
    startSession();
    await playUntil(() => events.some(e => e.type === 'session.ended'));

    expect(events.at(-1)).toEqual({
      type: 'session.ended',
      error: "the task's process stopped (code 3) before it finished",
    });
  }, 30_000);
});

/** A task process forked directly, so the test holds its channel itself. */
const forkRaw = () =>
  fork(ENTRY, ['run', '--', file], {
    env: { ...process.env, [CHILD_ENV]: '1' },
    execArgv: process.execArgv,
  });

/** Whether the child exits within `ms`. */
const exitsWithin = (child: ReturnType<typeof forkRaw>, ms: number) =>
  new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

/** Resolves once the child has said its task ended. */
const sawEnd = (child: ReturnType<typeof forkRaw>) =>
  new Promise<void>(resolve => {
    child.on('message', message => {
      if (typeof message === 'object' && message !== null && 'kind' in message) {
        if (message.kind === 'end') resolve();
      }
    });
  });

describe('the task process after the task ends', () => {
  it('exits by itself when nothing of the task is left running', async () => {
    await writeFile(file, 'export {};\n');
    const child = forkRaw();
    await sawEnd(child);
    expect(await exitsWithin(child, 10_000)).toBe(true);
  }, 30_000);

  it('stays while the task has timers, and exits when the CLI goes away', async () => {
    await writeFile(file, 'setInterval(() => {}, 1000);\n');
    const child = forkRaw();
    await sawEnd(child);
    expect(await exitsWithin(child, 1_000)).toBe(false);
    child.disconnect();
    expect(await exitsWithin(child, 10_000)).toBe(true);
  }, 30_000);
});
