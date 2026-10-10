// Each round: observe, let the decision model pick a move, invoke it.
import type { Merge } from 'type-fest';
import type { LoadedConfig } from './config.ts';
import { type RunEvent, toOpTree } from './events.ts';
import type { InspectorGlobal, RunHooks } from './inspector.ts';
import type { Ops } from './ops.ts';
import { pick, type Step } from './pick.ts';
import { createTurnAnswerer } from './turns.ts';

export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** What the model reads each round: the goal, written as the end state to reach, and any JSON. */
export type Context = { goal: string; [key: string]: Json };

type Outcome =
  | { status: 'achieved' }
  | { status: 'halted'; reason: 'noOptions' | 'stalled' | 'budget' }
  | { status: 'halted'; reason: 'error'; error: string };

/** What a run spent on the decision model: input tokens (output is free) and requests. */
export type Usage = { inputTokens: number; requests: number };

export type TaskResult = Merge<Outcome, { steps: string[]; context: Context | null; usage: Usage }>;

/** What a round starts with: what the model reads (`context`) and the moves it may pick (`ops`). */
export type Observe = () => Promise<{ context: Context; ops: Ops }>;

/**
 * A task run on the config `initGut` read: what `initGut` returns as `runTask`. `name` tells the run
 * apart from the task's other runs, in an inspector; the model never reads it.
 */
export type RunTask = (
  name: string,
  observe: Observe,
  options?: TaskOptions,
) => Promise<TaskResult>;

export type TaskOptions = {
  /** Input tokens the run may spend on the decision model; it may overshoot by one request. */
  inputTokenBudget?: number;
  /**
   * Checks the goal in code, after each round's `observe` and before any request. When it is set, the
   * model is never asked whether the goal is met: only this check ends a run as `achieved`.
   */
  isGoalAchieved?: () => boolean | Promise<boolean>;
};

const secondsSince = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const errorOutcome = (error: unknown): Extract<Outcome, { reason: 'error' }> => ({
  status: 'halted',
  reason: 'error',
  error: error instanceof Error ? error.message : String(error),
});

const writeStderr = (event: RunEvent) => {
  if (event.type === 'round.goalChecked' && event.achieved) {
    process.stderr.write(`round ${event.round}  achieved  checked  ${secondsSince(event.ms)}\n`);
    return;
  }
  if (event.type === 'round.picked') {
    process.stderr.write(
      `round ${event.round}  ${event.step}  ${event.probabilities.map(p => p.toFixed(2)).join('/')}  ${secondsSince(event.ms)}  ${event.tokens} input tokens\n`,
    );
    return;
  }
  if (event.type === 'run.ended') {
    const { result } = event;
    const outcome = (() => {
      if (result.status === 'achieved') return 'achieved';
      if (result.reason === 'error') return `halted: error (${result.error})`;
      return `halted: ${result.reason}`;
    })();
    process.stderr.write(
      `${outcome}  ${result.usage.inputTokens} input tokens in ${result.usage.requests} requests\n`,
    );
  }
};

/**
 * Runs a task until the goal is met, or the run halts. `observe` runs at the start of every round and
 * returns what the model reads (`context`) and the moves it may pick (`ops`). The model judges the
 * goal, unless `options.isGoalAchieved` checks it in code. `name` is for people; the model never
 * reads it.
 *
 * The decision model comes from `config`; what a run may spend, from `options`. An inspector's
 * `attach` injects who answers each turn; without a model and without hooks the run cannot start.
 */
export const runTask = async (
  config: LoadedConfig,
  name: string,
  observe: Observe,
  { inputTokenBudget = 50_000, isGoalAchieved }: TaskOptions = {},
  attach?: InspectorGlobal['attach'],
): Promise<TaskResult> => {
  const runId = crypto.randomUUID();
  const hooks: RunHooks | undefined = attach?.({ runId });

  // Each pick's question size: the inspector's choice, else the model's own limit.
  const maxOptionsFor = ((): ((round: number) => Promise<number>) => {
    if (hooks !== undefined) return async round => (await hooks.beforePick({ round })).maxOptions;
    if (config.decisionModel === null) {
      throw new Error('no decision model: pass a config, or attach an inspector');
    }
    const { maxOptions } = config.decisionModel.capabilities.choiceQuestions;
    return async () => maxOptions;
  })();

  const emit = (event: RunEvent) => {
    hooks?.onEvent(event);
    writeStderr(event);
  };

  const turnAnswerer = createTurnAnswerer({
    runId,
    model: config.decisionModel,
    inputTokenBudget,
    hooks,
    emit,
  });

  const seen = new Map<string, number>(); // context + step → how many times it was picked

  // Runs the picked op; a failure keeps what was spent picking it.
  const invoke = async (picked: Step, step: string, usage: Usage, roundNumber: number) => {
    const started = performance.now();
    try {
      await picked.invoke();
      emit({
        type: 'step.invoked',
        runId,
        round: roundNumber,
        step,
        ms: performance.now() - started,
      });
      return { status: 'continue' as const, step, usage };
    } catch (error) {
      emit({
        type: 'step.invoked',
        runId,
        round: roundNumber,
        step,
        ms: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...errorOutcome(error), usage };
    }
  };

  const executeRound = async ({
    context,
    ops,
    usage,
    roundNumber,
    started,
  }: {
    context: Context;
    ops: Ops;
    usage: Usage;
    roundNumber: number;
    started: number;
  }): Promise<Merge<Outcome | { status: 'continue'; step: string }, { usage: Usage }>> => {
    try {
      if (isGoalAchieved !== undefined) {
        const achieved = await isGoalAchieved();
        emit({
          type: 'round.goalChecked',
          runId,
          round: roundNumber,
          achieved,
          ms: performance.now() - started,
        });
        if (achieved) return { status: 'achieved', usage };
      }

      let usageSoFar = usage;

      // A re-pick keeps what the abandoned pick spent, and asks the same ops again from turn 1.
      const abandon = (spent: Usage) => {
        emit({
          type: 'pick.abandoned',
          runId,
          round: roundNumber,
          usage: {
            inputTokens: spent.inputTokens - usageSoFar.inputTokens,
            requests: spent.requests - usageSoFar.requests,
          },
        });
        usageSoFar = spent;
      };

      for (;;) {
        const maxOptions = await maxOptionsFor(roundNumber);
        emit({ type: 'pick.started', runId, round: roundNumber, maxOptions });

        const picked = await pick({
          asker: turnAnswerer.forPick(roundNumber),
          context,
          ops,
          usage: usageSoFar,
          isGoalAsked: isGoalAchieved === undefined,
          maxOptions,
        });

        if (picked.status === 'repick') {
          abandon(picked.usage);
          continue;
        }

        if (picked.status === 'halted') return picked;
        if (picked.status === 'failed') {
          return { ...errorOutcome(picked.error), usage: picked.usage };
        }

        const step = picked.status === 'achieved' ? 'achieved' : picked.step.name;
        emit({
          type: 'round.picked',
          runId,
          round: roundNumber,
          step,
          address: picked.status === 'achieved' ? null : picked.step.address,
          probabilities: picked.probabilities,
          tokens: picked.usage.inputTokens - usage.inputTokens,
          ms: performance.now() - started,
        });

        if (picked.status === 'achieved') return { status: 'achieved', usage: picked.usage };

        if (hooks !== undefined) {
          const action = await hooks.beforeInvoke({ round: roundNumber, step });
          if (action === 'repick') {
            abandon(picked.usage);
            continue;
          }
        }

        const key = `${JSON.stringify(context)}\n${step}`;
        const repeats = (seen.get(key) ?? 0) + 1;
        seen.set(key, repeats);
        if (repeats >= 3) return { status: 'halted', reason: 'stalled', usage: picked.usage };

        return await invoke(picked.step, step, picked.usage, roundNumber);
      }
    } catch (error) {
      return { ...errorOutcome(error), usage };
    }
  };

  const advance = async ({
    context,
    steps,
    usage,
    roundNumber,
  }: {
    context: Context | null;
    steps: string[];
    usage: Usage;
    roundNumber: number;
  }): Promise<TaskResult> => {
    const started = performance.now();
    const observed = await (async () => {
      try {
        const { context, ops } = await observe();
        // An invoke may mutate what the context points at; the result keeps this snapshot.
        return { status: 'observed' as const, context: structuredClone(context), ops };
      } catch (error) {
        return errorOutcome(error);
      }
    })();
    if (observed.status !== 'observed') return { ...observed, steps, context, usage };

    emit({
      type: 'round.observed',
      runId,
      round: roundNumber,
      context: observed.context,
      ops: toOpTree(observed.ops),
    });

    const outcome = await executeRound({
      context: observed.context,
      ops: observed.ops,
      usage,
      roundNumber,
      started,
    });
    if (outcome.status !== 'continue') return { ...outcome, steps, context: observed.context };
    return advance({
      context: observed.context,
      steps: [...steps, outcome.step],
      usage: outcome.usage,
      roundNumber: roundNumber + 1,
    });
  };

  emit({
    type: 'run.started',
    runId,
    name,
    model:
      config.decisionModel === null
        ? null
        : {
            name: config.decisionModel.name,
            endpoint: config.decisionModel.endpoint,
            maxOptions: config.decisionModel.capabilities.choiceQuestions.maxOptions,
          },
    inputTokenBudget,
    isGoalCheckedInCode: isGoalAchieved !== undefined,
  });

  const result = await advance({
    context: null,
    steps: [],
    usage: { inputTokens: 0, requests: 0 },
    roundNumber: 1,
  });
  emit({ type: 'run.ended', runId, result });
  return result;
};
