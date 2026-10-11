// The CLI's side of an inspected session: Play or Step, the model set in the page, the decisions
// runs wait on, and the task's process. Its runs attach through the link it gives the process; the
// page acts through `act`. Hooks never throw: core treats whatever they return as the answer.
import {
  type Action,
  answersFromYou,
  type DecisionModel,
  DecisionModelSchema,
  type DecisionRequest,
  type Edit,
  effectiveMaxOptions,
  type InspectorEvent,
  type Mode,
  type ModelInfo,
  type OpTreeNode,
  PROTOCOL,
  type RunHooks,
  type TurnAnswer,
} from '@gut.run/core/inspector';
import { z } from 'zod';
import { editProblem } from './edits.ts';

type Resolution =
  | { by: 'you'; answers: Readonly<Record<string, string>> }
  | { by: 'model' }
  | { by: 'run' }
  | { by: 'repick' };

/** A turn keeps its request, to check a person's answers before core sees them. */
type Pending = { runId: string; round: number; resolve: (resolution: Resolution) => void } & (
  | { on: 'turn'; request: DecisionRequest }
  | { on: 'step' }
);

/** What the task's process reports to the session: its runs' hooks, and that it ended. */
export type TaskLink = {
  attach: (run: { runId: string }) => RunHooks;
  /** The task's top-level code finished, or stopped with `error`. */
  end: (error?: string) => void;
};

/** The task's process, as the session runs it: `stop` kills it and resolves once it has exited. */
export type TaskProcess = { stop: () => Promise<void> };

/** What an action got: done, or refused with the status the page receives. */
export type ActResult = { status: 204 } | { status: 400 | 409; error: string };

const infoOf = (model: DecisionModel): ModelInfo => ({
  name: model.name,
  endpoint: model.endpoint,
  maxOptions: model.capabilities.choiceQuestions.maxOptions,
});

/**
 * What a stale task's call gets: a promise that never settles, so nothing the task does after a
 * restart reaches the record, and a stopped task doesn't spin on a harmless answer until it is killed.
 */
const stalled = <Result>() => new Promise<Result>(() => {});

export const createSession = ({
  task,
  emit,
  clear,
  warn,
  readConfig,
  start,
}: {
  task: string;
  emit: (event: InspectorEvent) => void;
  /** Forgets the record; a restart begins it afresh. */
  clear: () => void;
  warn: (message: string) => void;
  /** Reads a gut config's model; throws, with a message for the page, when it can't. */
  readConfig: (path: string) => Promise<DecisionModel>;
  /** Starts the task's process, reporting to `link`. */
  start: (link: TaskLink) => TaskProcess;
}) => {
  let mode: Mode = 'step';
  /** Set in the page, for runs whose config has none; its key never leaves this closure. */
  let pageModel: DecisionModel | null = null;
  /** Each run's own model, from its `run.started`. */
  const runModels = new Map<string, ModelInfo | null>();
  /** Each run's latest observed op tree, which the developer's edits are checked against. */
  const observed = new Map<string, { round: number; ops: OpTreeNode[] }>();
  /** The edits a run's round is picked with: a re-pick gives them, and they end with the round. */
  const held = new Map<string, { round: number; edits: Edit[] }>();
  /** The question size the developer chose; null until they choose one. */
  let chosenMaxOptions: number | null = null;
  /** Runs whose pick in flight starts over at its next turn or step, after a size change in Step. */
  const heldRepicks = new Set<string>();
  const pending = new Map<string, Pending>();
  let nextDecision = 1;
  /**
   * Counts the task's processes: a process's messages count only while it is the latest one, so
   * one a restart has stopped can't reach the record.
   */
  let generation = 0;
  let attached = 0;
  let current: TaskProcess | undefined;
  /** Restarts and stops run one after another, so two processes never overlap. */
  let queue: Promise<void> = Promise.resolve();

  const announce = () => {
    emit({ type: 'session.started', protocol: PROTOCOL, task, mode });
    if (pageModel !== null) emit({ type: 'session.model', model: infoOf(pageModel) });
    if (chosenMaxOptions !== null) {
      emit({ type: 'session.maxOptions', maxOptions: chosenMaxOptions });
    }
  };

  const hasModel = (runId: string) => (runModels.get(runId) ?? pageModel) !== null;

  /** The limit of the model a run answers with: its own, else the page's; null with neither. */
  const modelMaxOptionsFor = (runId: string) =>
    runModels.get(runId)?.maxOptions ?? pageModel?.capabilities.choiceQuestions.maxOptions ?? null;

  /** The question size a pick at this run asks now. */
  const maxOptionsFor = (runId: string) =>
    effectiveMaxOptions({ chosen: chosenMaxOptions, modelMax: modelMaxOptionsFor(runId) });

  /** The op tree a round was observed with; none for another round. */
  const opsOf = (runId: string, round: number): OpTreeNode[] => {
    const entry = observed.get(runId);
    return entry?.round === round ? entry.ops : [];
  };

  /** The edits a round is picked with: those a re-pick gave it, none for another round. */
  const editsOf = (runId: string, round: number): Edit[] => {
    const entry = held.get(runId);
    return entry?.round === round ? entry.edits : [];
  };

  /** The run's own model when it has one, else the page's. */
  const modelAnswer = (runId: string): TurnAnswer =>
    runModels.get(runId) === null && pageModel !== null
      ? { by: 'model', model: pageModel }
      : { by: 'model' };

  /** Records a decision the run waits on, and waits for the page (or Play) to resolve it. */
  const waitFor = (
    runId: string,
    round: number,
    on: { kind: 'turn'; turn: number; request: DecisionRequest } | { kind: 'step'; step: string },
  ) =>
    new Promise<Resolution>(resolve => {
      const id = `d${nextDecision++}`;
      const settle = (resolution: Resolution) => {
        pending.delete(id);
        emit({ type: 'decision.resolved', id, by: resolution.by });
        resolve(resolution);
      };
      pending.set(
        id,
        on.kind === 'turn'
          ? { runId, round, on: 'turn', request: on.request, resolve: settle }
          : { runId, round, on: 'step', resolve: settle },
      );
      emit({
        type: 'decision.pending',
        id,
        runId,
        round,
        on: on.kind === 'turn' ? { kind: 'turn', turn: on.turn } : on,
      });
    });

  /** The hooks of a run in the process started at `of`; once a restart makes it stale, they go quiet. */
  const hooksFor = (runId: string, of: number): RunHooks => {
    const isLatest = () => of === generation;
    return {
      onEvent: event => {
        if (!isLatest()) return;
        if (event.type === 'run.started') runModels.set(runId, event.model);
        if (event.type === 'round.observed') {
          observed.set(runId, { round: event.round, ops: event.ops });
        }
        emit(event);
      },
      answer: async ({ round, turn, request }) => {
        if (!isLatest()) return stalled();
        if (mode === 'play' && hasModel(runId)) return modelAnswer(runId);
        if (heldRepicks.delete(runId)) return { repick: true };
        const resolution = await waitFor(runId, round, { kind: 'turn', turn, request });
        if (!isLatest()) return stalled();
        if (resolution.by === 'you') return { by: 'you', answers: resolution.answers };
        if (resolution.by === 'repick') return { repick: true };
        return modelAnswer(runId);
      },
      beforePick: async ({ round }) => {
        if (!isLatest()) return stalled();
        // A pick starting now takes the size as it is, so a re-pick held for the last one is moot.
        heldRepicks.delete(runId);
        return { maxOptions: maxOptionsFor(runId), edits: editsOf(runId, round) };
      },
      beforeInvoke: async ({ round, step }) => {
        if (!isLatest()) return stalled();
        if (mode === 'play' && hasModel(runId)) return 'invoke';
        if (heldRepicks.delete(runId)) return 'repick';
        const resolution = await waitFor(runId, round, { kind: 'step', step });
        if (!isLatest()) return stalled();
        return resolution.by === 'repick' ? 'repick' : 'invoke';
      },
    };
  };

  const endTask = (error?: string) => {
    emit({ type: 'session.ended', ...(error === undefined ? {} : { error }) });
    warn(error === undefined ? 'The task ended.' : `The task ended: ${error}`);
    if (attached === 0) {
      warn(
        'No run attached: the task never called runTask, or its @gut.run/core predates the inspector.',
      );
    }
    warn('The inspector stays up until Ctrl-C.');
  };

  /** The link of the process started at `of`: ignored once a restart has made it stale. */
  const linkFor = (of: number): TaskLink => ({
    attach: ({ runId }) => {
      if (of === generation) attached += 1;
      return hooksFor(runId, of);
    },
    end: error => {
      if (of === generation) endTask(error);
    },
  });

  /** Forgets the current process: its decisions are dropped, and its messages ignored. */
  const retire = () => {
    generation += 1;
    pending.clear();
    runModels.clear();
    observed.clear();
    held.clear();
    heldRepicks.clear();
    return generation;
  };

  const inTurn = (step: () => Promise<void>) => {
    queue = queue.then(step);
    return queue;
  };

  const restart = () => {
    const of = retire();
    return inTurn(async () => {
      await current?.stop();
      attached = 0;
      clear();
      announce();
      current = start(linkFor(of));
    });
  };

  const setPageModel = (model: DecisionModel | null) => {
    pageModel = model;
    emit({ type: 'session.model', model: model === null ? null : infoOf(model) });
  };

  /** The pending decision an action names, or why it can't be acted on. */
  const decisionFor = (id: string): Pending | Extract<ActResult, { error: string }> =>
    pending.get(id) ?? { status: 409, error: `no decision ${id} is waiting` };

  const notA = (id: string, kind: 'turn' | 'step'): ActResult => ({
    status: 400,
    error: `${id} is not a ${kind}`,
  });

  const act = async (action: Action): Promise<ActResult> => {
    switch (action.type) {
      case 'play': {
        mode = 'play';
        emit({ type: 'session.mode', mode });
        // Play applies a size from the next pick, so a re-pick held in Step is dropped.
        heldRepicks.clear();
        // What waits now goes on as Play would have: the model answers, the step runs.
        for (const decision of [...pending.values()]) {
          if (!hasModel(decision.runId)) continue;
          decision.resolve(decision.on === 'step' ? { by: 'run' } : { by: 'model' });
        }
        return { status: 204 };
      }
      case 'setMaxOptions': {
        chosenMaxOptions = action.maxOptions;
        emit({ type: 'session.maxOptions', maxOptions: action.maxOptions });
        if (mode === 'play') return { status: 204 };
        // In Step a pick waiting on a person starts over now; one in flight starts over at its next turn or step.
        for (const runId of runModels.keys()) heldRepicks.add(runId);
        for (const decision of [...pending.values()]) decision.resolve({ by: 'repick' });
        return { status: 204 };
      }
      case 'pause': {
        mode = 'step';
        emit({ type: 'session.mode', mode });
        return { status: 204 };
      }
      case 'restart': {
        await restart();
        return { status: 204 };
      }
      case 'answer': {
        const decision = decisionFor(action.decision);
        if ('error' in decision) return decision;
        if (decision.on !== 'turn') return notA(action.decision, 'turn');
        const checked = answersFromYou(decision.request, action.answers);
        if (typeof checked === 'string') return { status: 400, error: checked };
        decision.resolve({ by: 'you', answers: action.answers });
        return { status: 204 };
      }
      case 'askModel': {
        const decision = decisionFor(action.decision);
        if ('error' in decision) return decision;
        if (decision.on !== 'turn') return notA(action.decision, 'turn');
        if (!hasModel(decision.runId)) return { status: 400, error: 'no model: add one first' };
        // A question asked at a larger size than the model takes is asked again at the model's
        // size (`beforePick` follows the model), rather than failing the run.
        const isTooBig = Object.values(decision.request.questions).some(
          question => Object.keys(question.criteria).length > maxOptionsFor(decision.runId),
        );
        decision.resolve(isTooBig ? { by: 'repick' } : { by: 'model' });
        return { status: 204 };
      }
      case 'run': {
        const decision = decisionFor(action.decision);
        if ('error' in decision) return decision;
        if (decision.on !== 'step') return notA(action.decision, 'step');
        decision.resolve({ by: 'run' });
        return { status: 204 };
      }
      case 'repick': {
        const decision = decisionFor(action.decision);
        if ('error' in decision) return decision;
        if (action.edits !== undefined) {
          const problem = editProblem(opsOf(decision.runId, decision.round), action.edits);
          if (problem !== undefined) return { status: 400, error: problem };
          held.set(decision.runId, { round: decision.round, edits: action.edits });
        }
        decision.resolve({ by: 'repick' });
        return { status: 204 };
      }
      case 'setModel': {
        const { maxOptions, ...rest } = action.model;
        const parsed = DecisionModelSchema.safeParse({
          ...rest,
          ...(maxOptions === undefined
            ? {}
            : { capabilities: { choiceQuestions: { maxOptions } } }),
        });
        if (!parsed.success) return { status: 400, error: z.prettifyError(parsed.error) };
        setPageModel(parsed.data);
        return { status: 204 };
      }
      case 'clearModel': {
        setPageModel(null);
        return { status: 204 };
      }
      case 'loadConfig': {
        try {
          setPageModel(await readConfig(action.path));
          return { status: 204 };
        } catch (error) {
          return { status: 400, error: error instanceof Error ? error.message : String(error) };
        }
      }
    }
  };

  announce();
  current = start(linkFor(generation));

  return {
    act,
    /** Stops the task's process, for the CLI's own exit. */
    stop: () => {
      retire();
      return inTurn(async () => {
        await current?.stop();
        current = undefined;
      });
    },
  };
};
