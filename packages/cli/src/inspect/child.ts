// The task's side of `gut run --inspect`: this process runs the task, and reports to the CLI that
// forked it (`task-process.ts`). The inspector global is set before the task is imported, so the
// task's `initGut` finds it, and its hooks are the session's, reached over IPC.
import {
  INSPECTOR_KEY,
  type InspectorGlobal,
  PROTOCOL,
  type RunHooks,
} from '@gut.run/core/inspector';
import {
  type CallHook,
  type CallMessage,
  CHILD_ENV,
  CliMessageSchema,
  type HookResults,
  type TaskMessage,
} from './ipc.ts';

/** Whether this process is a task forked by an inspected run. */
export const isInspectChild = () => process.env[CHILD_ENV] === '1' && process.send !== undefined;

export const runInspectChild = async (taskUrl: string) => {
  // Once the task has ended, the channel closes; a message after that has nowhere to go.
  const send = (message: TaskMessage) => {
    if (process.connected) process.send?.(message);
  };

  const waiting = new Map<number, (value: HookResults[CallHook]) => void>();
  let nextId = 1;
  const ask = <Result>(call: (id: number) => CallMessage) =>
    new Promise<Result>(resolve => {
      const id = nextId;
      nextId += 1;
      // The CLI answers each hook with that hook's result, which is `Result`.
      waiting.set(id, value => resolve(value as Result));
      send(call(id));
    });

  process.on('message', message => {
    const parsed = CliMessageSchema.safeParse(message);
    if (!parsed.success) return;
    waiting.get(parsed.data.id)?.(parsed.data.value);
    waiting.delete(parsed.data.id);
  });

  const hooksFor = (runId: string): RunHooks => ({
    onEvent: event => send({ kind: 'event', event }),
    answer: arg =>
      ask<HookResults['answer']>(id => ({ kind: 'call', id, runId, hook: 'answer', arg })),
    beforePick: arg =>
      ask<HookResults['beforePick']>(id => ({ kind: 'call', id, runId, hook: 'beforePick', arg })),
    beforeInvoke: arg =>
      ask<HookResults['beforeInvoke']>(id => ({
        kind: 'call',
        id,
        runId,
        hook: 'beforeInvoke',
        arg,
      })),
  });

  const inspector: InspectorGlobal = {
    protocol: PROTOCOL,
    attach: ({ runId }) => {
      send({ kind: 'attach', runId });
      return hooksFor(runId);
    },
  };
  Reflect.set(globalThis, INSPECTOR_KEY, inspector);

  // A CLI that goes away (killed, not stopped) leaves no one to answer: the task goes with it. The
  // channel stays open after the task finishes, so this still holds while its timers run.
  process.on('disconnect', () => process.exit());

  let error: string | undefined;
  try {
    await import(taskUrl);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    process.exitCode = 1;
  }
  const end: TaskMessage = { kind: 'end', ...(error === undefined ? {} : { error }) };
  // Once the end is delivered, the channel stops holding the process: the task's own timers keep it
  // alive, and the process exits with them. Until then, or while the CLI is still here, it stays up.
  if (process.connected) {
    process.send?.(end, () => process.channel?.unref());
  }
};
