// Each tick: observe, let the decision model pick a move, invoke it.
import type { Merge } from 'type-fest';
import type { Config } from './config.ts';
import type { Ops } from './ops.ts';
import { pick, type Step } from './pick.ts';

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** What the model reads each tick: the goal, written as the end state to reach, and any JSON. */
export type Context = { goal: string; [key: string]: Json };

type Outcome =
  | { status: 'achieved' }
  | { status: 'halted'; reason: 'noOptions' | 'stalled' | 'budget' }
  | { status: 'halted'; reason: 'error'; error: string };

/** What a run spent on the decision model: input tokens (output is free) and requests. */
export type Usage = { inputTokens: number; requests: number };

export type TaskResult = Merge<Outcome, { steps: string[]; context: Context | null; usage: Usage }>;

/** A task run on the config `initGut` read: what `initGut` returns as `runTask`. */
export type RunTask = (
  tick: () => Promise<{ context: Context; ops: Ops }>,
  options?: TaskOptions,
) => Promise<TaskResult>;

export type TaskOptions = {
  /** Input tokens the run may spend on the decision model; it may overshoot by one request. */
  inputTokenBudget?: number;
  /**
   * Checks the goal in code, after each tick's `tick` and before any request. When it is set, the
   * model is never asked whether the goal is met: only this check ends a run as `achieved`.
   */
  isGoalAchieved?: () => boolean | Promise<boolean>;
};

const secondsSince = (started: number) => `${((performance.now() - started) / 1000).toFixed(1)}s`;

const errorOutcome = (error: unknown): Extract<Outcome, { reason: 'error' }> => ({
  status: 'halted',
  reason: 'error',
  error: error instanceof Error ? error.message : String(error),
});

/**
 * Runs a task until the goal is met, or the run halts. `tick` runs at the start of every tick and
 * returns what the model reads (`context`) and the moves it may pick (`ops`). The model judges the
 * goal, unless `options.isGoalAchieved` checks it in code.
 *
 * The decision model comes from `config`; what a run may spend, from `options`.
 */
export const runTask = async (
  config: Config,
  tick: () => Promise<{ context: Context; ops: Ops }>,
  { inputTokenBudget = 50_000, isGoalAchieved }: TaskOptions = {},
): Promise<TaskResult> => {
  const asker = { decisionModel: config.decisionModel, inputTokenBudget };
  const seen = new Map<string, number>(); // context + step → how many times it was picked

  // Runs the picked op; a failure keeps what was spent picking it.
  const invoke = async (picked: Step, step: string, usage: Usage) => {
    try {
      await picked.invoke();
      return { status: 'continue' as const, step, usage };
    } catch (error) {
      return { ...errorOutcome(error), usage };
    }
  };

  const executeTick = async ({
    context,
    ops,
    usage,
    tickNumber,
    started,
  }: {
    context: Context;
    ops: Ops;
    usage: Usage;
    tickNumber: number;
    started: number;
  }): Promise<Merge<Outcome | { status: 'continue'; step: string }, { usage: Usage }>> => {
    try {
      if (isGoalAchieved !== undefined && (await isGoalAchieved())) {
        process.stderr.write(`tick ${tickNumber}  achieved  checked  ${secondsSince(started)}\n`);
        return { status: 'achieved', usage };
      }

      const picked = await pick({
        asker,
        context,
        ops,
        usage,
        isGoalAsked: isGoalAchieved === undefined,
      });
      if (picked.status === 'halted') return picked;
      if (picked.status === 'failed') return { ...errorOutcome(picked.error), usage: picked.usage };

      const step = picked.status === 'achieved' ? 'achieved' : picked.step.name;
      process.stderr.write(
        `tick ${tickNumber}  ${step}  ${picked.probabilities.map(p => p.toFixed(2)).join('/')}  ${secondsSince(started)}  ${picked.usage.inputTokens - usage.inputTokens} input tokens\n`,
      );
      if (picked.status === 'achieved') return { status: 'achieved', usage: picked.usage };

      const key = `${JSON.stringify(context)}\n${step}`;
      const repeats = (seen.get(key) ?? 0) + 1;
      seen.set(key, repeats);
      if (repeats >= 3) return { status: 'halted', reason: 'stalled', usage: picked.usage };

      return await invoke(picked.step, step, picked.usage);
    } catch (error) {
      return { ...errorOutcome(error), usage };
    }
  };

  const advance = async ({
    context,
    steps,
    usage,
    tickNumber,
  }: {
    context: Context | null;
    steps: string[];
    usage: Usage;
    tickNumber: number;
  }): Promise<TaskResult> => {
    const started = performance.now();
    const observed = await (async () => {
      try {
        const { context, ops } = await tick();
        // An invoke may mutate what the context points at; the result keeps this snapshot.
        return { status: 'observed' as const, context: structuredClone(context), ops };
      } catch (error) {
        return errorOutcome(error);
      }
    })();
    if (observed.status !== 'observed') return { ...observed, steps, context, usage };

    const outcome = await executeTick({
      context: observed.context,
      ops: observed.ops,
      usage,
      tickNumber,
      started,
    });
    if (outcome.status !== 'continue') return { ...outcome, steps, context: observed.context };
    return advance({
      context: observed.context,
      steps: [...steps, outcome.step],
      usage: outcome.usage,
      tickNumber: tickNumber + 1,
    });
  };

  const result = await advance({
    context: null,
    steps: [],
    usage: { inputTokens: 0, requests: 0 },
    tickNumber: 1,
  });
  const outcome = (() => {
    if (result.status === 'achieved') return 'achieved';
    if (result.reason === 'error') return `halted: error (${result.error})`;
    return `halted: ${result.reason}`;
  })();
  process.stderr.write(
    `${outcome}  ${result.usage.inputTokens} input tokens in ${result.usage.requests} requests\n`,
  );
  return result;
};
