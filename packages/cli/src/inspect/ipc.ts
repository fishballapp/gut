// The messages between the CLI and the process that runs its task (`task-process.ts` forks it,
// `child.ts` is its side). The task's core calls each inspector hook as a request, and the CLI's
// session answers it under the same id; a run's events are sent and forgotten.
import { RunEventSchema, type RunHooks, type TurnAnswer } from '@gut.run/core/inspector';
import { z } from 'zod';

/** Set to 1 in the task's process, so `gut run` there reports to the CLI that forked it. */
export const CHILD_ENV = 'GUT_INSPECT_CHILD';

/** The hooks a task's core waits on for an answer. */
export type CallHook = 'answer' | 'beforePick' | 'beforeInvoke';

export type HookArgs = {
  answer: Parameters<RunHooks['answer']>[0];
  beforePick: Parameters<RunHooks['beforePick']>[0];
  beforeInvoke: Parameters<RunHooks['beforeInvoke']>[0];
};

export type HookResults = {
  answer: TurnAnswer;
  beforePick: Awaited<ReturnType<RunHooks['beforePick']>>;
  beforeInvoke: Awaited<ReturnType<RunHooks['beforeInvoke']>>;
};

// The arguments are the task core's own shapes, passed through unchecked. Events are checked: the
// task's core may be another version, and the page only reads what the schema admits.
const callOf = <Hook extends CallHook>(hook: Hook) =>
  z.object({
    kind: z.literal('call'),
    id: z.number().int(),
    runId: z.string(),
    hook: z.literal(hook),
    arg: z.custom<HookArgs[Hook]>(),
  });

/** From the task's process to the CLI. */
export const TaskMessageSchema = z.union([
  z.object({ kind: z.literal('attach'), runId: z.string() }),
  z.object({ kind: z.literal('event'), event: RunEventSchema }),
  z.discriminatedUnion('hook', [callOf('answer'), callOf('beforePick'), callOf('beforeInvoke')]),
  /** The task's top-level code finished, or threw with `error`. */
  z.object({ kind: z.literal('end'), error: z.string().optional() }),
]);

export type TaskMessage = z.infer<typeof TaskMessageSchema>;

export type CallMessage = Extract<TaskMessage, { kind: 'call' }>;

/** From the CLI to the task's process: the answer to the call with this id. */
export const CliMessageSchema = z.object({
  kind: z.literal('result'),
  id: z.number().int(),
  value: z.custom<HookResults[CallHook]>(),
});

export type CliMessage = z.infer<typeof CliMessageSchema>;
