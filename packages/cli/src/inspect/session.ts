// The CLI's side of an inspected session: Play or Step, the model set in the page, and the
// decisions runs wait on. Runs attach through the global hook (`attach`); the page acts through
// `act`. Hooks never throw: core treats whatever they return as the answer.
import {
  type Action,
  answersFromYou,
  type DecisionModel,
  DecisionModelSchema,
  type DecisionRequest,
  type InspectorEvent,
  type InspectorGlobal,
  type Mode,
  type ModelInfo,
  PROTOCOL,
  RunEventSchema,
  type RunHooks,
  type TurnAnswer,
} from '@gut.run/core/inspector';
import { z } from 'zod';

/** A question size a person can read, for a run with no model to size it by. */
const PERSON_MAX_OPTIONS = 26;

type Resolution =
  | { by: 'you'; answers: Readonly<Record<string, string>> }
  | { by: 'model' }
  | { by: 'run' }
  | { by: 'repick' };

/** A turn keeps its request, to check a person's answers before core sees them. */
type Pending = { runId: string; resolve: (resolution: Resolution) => void } & (
  | { on: 'turn'; request: DecisionRequest }
  | { on: 'step' }
);

/** What an action got: done, or refused with the status the page receives. */
export type ActResult = { status: 204 } | { status: 400 | 409; error: string };

const infoOf = (model: DecisionModel): ModelInfo => ({
  name: model.name,
  endpoint: model.endpoint,
  maxOptions: model.capabilities.choiceQuestions.maxOptions,
});

export const createSession = ({
  task,
  emit,
  warn,
}: {
  task: string;
  emit: (event: InspectorEvent) => void;
  warn: (message: string) => void;
}) => {
  let mode: Mode = 'step';
  /** Set in the page, for runs whose config has none; its key never leaves this closure. */
  let pageModel: DecisionModel | null = null;
  /** Each run's own model, from its `run.started`. */
  const runModels = new Map<string, ModelInfo | null>();
  const pending = new Map<string, Pending>();
  let nextDecision = 1;

  emit({ type: 'session.started', protocol: PROTOCOL, task, mode });

  const hasModel = (runId: string) => (runModels.get(runId) ?? pageModel) !== null;

  /** A question size the run's model takes, else the page's, else one a person can read. */
  const maxOptionsFor = (runId: string) =>
    runModels.get(runId)?.maxOptions ??
    pageModel?.capabilities.choiceQuestions.maxOptions ??
    PERSON_MAX_OPTIONS;

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
          ? { runId, on: 'turn', request: on.request, resolve: settle }
          : { runId, on: 'step', resolve: settle },
      );
      emit({
        type: 'decision.pending',
        id,
        runId,
        round,
        on: on.kind === 'turn' ? { kind: 'turn', turn: on.turn } : on,
      });
    });

  const hooksFor = (runId: string): RunHooks => ({
    onEvent: event => {
      // The task's core may be another version: its events are checked once, here.
      const parsed = RunEventSchema.safeParse(event);
      if (!parsed.success) {
        warn(`gut inspector: dropped an event core sent: ${z.prettifyError(parsed.error)}`);
        return;
      }
      if (parsed.data.type === 'run.started') runModels.set(runId, parsed.data.model);
      emit(parsed.data);
    },
    answer: async ({ round, turn, request }) => {
      if (mode === 'play' && hasModel(runId)) return modelAnswer(runId);
      const resolution = await waitFor(runId, round, { kind: 'turn', turn, request });
      if (resolution.by === 'you') return { by: 'you', answers: resolution.answers };
      if (resolution.by === 'repick') return { repick: true };
      return modelAnswer(runId);
    },
    beforePick: async () => ({ maxOptions: maxOptionsFor(runId) }),
    beforeInvoke: async ({ round, step }) => {
      if (mode === 'play' && hasModel(runId)) return 'invoke';
      const resolution = await waitFor(runId, round, { kind: 'step', step });
      return resolution.by === 'repick' ? 'repick' : 'invoke';
    },
  });

  let attached = 0;

  const attach: InspectorGlobal['attach'] = ({ runId }): RunHooks => {
    attached += 1;
    return hooksFor(runId);
  };

  /** The pending decision an action names, or why it can't be acted on. */
  const decisionFor = (id: string): Pending | Extract<ActResult, { error: string }> =>
    pending.get(id) ?? { status: 409, error: `no decision ${id} is waiting` };

  const notA = (id: string, kind: 'turn' | 'step'): ActResult => ({
    status: 400,
    error: `${id} is not a ${kind}`,
  });

  const act = (action: Action): ActResult => {
    switch (action.type) {
      case 'play': {
        mode = 'play';
        emit({ type: 'session.mode', mode });
        // What waits now goes on as Play would have: the model answers, the step runs.
        for (const decision of [...pending.values()]) {
          if (!hasModel(decision.runId)) continue;
          decision.resolve(decision.on === 'step' ? { by: 'run' } : { by: 'model' });
        }
        return { status: 204 };
      }
      case 'pause': {
        mode = 'step';
        emit({ type: 'session.mode', mode });
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
        pageModel = parsed.data;
        emit({ type: 'session.model', model: infoOf(parsed.data) });
        return { status: 204 };
      }
    }
  };

  return {
    attach,
    act,
    /** Whether any run attached: none means the task's core predates the inspector. */
    hasAttached: () => attached > 0,
    end: (error?: string) => {
      emit({ type: 'session.ended', ...(error === undefined ? {} : { error }) });
    },
  };
};
