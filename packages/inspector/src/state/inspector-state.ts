// What the page knows: a pure function of the ordered event stream the CLI serves. Every run, round
// and turn is kept, answered or not, so any of them can be opened during or after the run.
import type {
  InspectorEvent,
  Mode,
  ModelInfo,
  OpAddress,
  OpTreeNode,
  OptionInfo,
  RunEvent,
  SessionEvent,
} from '@gut.run/core/inspector';
import { PROTOCOL, SessionEventSchema } from '@gut.run/core/inspector';

type EventOf<Type extends InspectorEvent['type']> = Extract<InspectorEvent, { type: Type }>;

export type Usage = { inputTokens: number; requests: number };

export type TaskResult = EventOf<'run.ended'>['result'];

export type Turn = {
  turn: number;
  /** Which pick of the round asked it: 1, then one more per re-pick. */
  pick: number;
  /** The state and questions exactly as sent. */
  request: EventOf<'turn.asked'>['request'];
  /** By question key, then criterion key: what each option is. */
  optionInfo: Record<string, Record<string, OptionInfo>>;
  retries: Omit<EventOf<'turn.retrying'>, 'type' | 'runId' | 'round' | 'turn'>[];
  outcome:
    | { status: 'asked' }
    | ({ status: 'answered' } & Omit<EventOf<'turn.answered'>, 'type' | 'runId' | 'round' | 'turn'>)
    | { status: 'failed'; error: string; isTooLarge: boolean }
    | { status: 'dropped'; reason: 'repick' | 'budget' };
};

/** The step a pick settled on, before it ran. */
export type PickedStep = {
  step: string;
  address: OpAddress | null;
  probabilities: number[];
  tokens: number;
  ms: number;
};

export type Pick = {
  maxOptions: number;
  /** Set when a re-pick abandoned it: what it spent, and the step it had picked if it got that far. */
  abandoned?: Usage;
  picked?: PickedStep;
};

export type Round = {
  round: number;
  context: Extract<RunEvent, { type: 'round.observed' }>['context'];
  ops: OpTreeNode[];
  goalChecked?: { achieved: boolean; ms: number };
  picks: Pick[];
  turns: Turn[];
  /** The current pick's step; a re-pick moves it to the abandoned pick. */
  picked?: PickedStep;
  invoked?: { step: string; ms: number; error?: string };
};

export type Run = {
  runId: string;
  name: string;
  /** The run's own model, from its config; null when it has none. */
  model: ModelInfo | null;
  inputTokenBudget: number;
  isGoalCheckedInCode: boolean;
  rounds: Round[];
  result?: TaskResult;
};

export type Decision = Omit<EventOf<'decision.pending'>, 'type'>;

export type InspectorState = {
  task?: string;
  mode: Mode;
  /** The model set in the page, for runs without their own. */
  pageModel: ModelInfo | null;
  runs: Run[];
  /** Decisions the runs wait on, oldest first. */
  pending: Decision[];
  /** Set once the task's top-level code finished or threw. */
  ended?: { error?: string };
  /** The CLI speaks another protocol than this page: nothing after `session.started` is read. */
  incompatible?: { cli: number; page: number };
};

export const initialState: InspectorState = {
  mode: 'step',
  pageModel: null,
  runs: [],
  pending: [],
};

const updateRun = (state: InspectorState, runId: string, update: (run: Run) => Run) => ({
  ...state,
  runs: state.runs.map(run => (run.runId === runId ? update(run) : run)),
});

const updateRound = (run: Run, round: number, update: (round: Round) => Round): Run => ({
  ...run,
  rounds: run.rounds.map(entry => (entry.round === round ? update(entry) : entry)),
});

const updateTurn = (round: Round, turn: number, update: (turn: Turn) => Turn): Round => ({
  ...round,
  turns: round.turns.map(entry => (entry.turn === turn ? update(entry) : entry)),
});

const reduceSession = (state: InspectorState, event: SessionEvent): InspectorState => {
  switch (event.type) {
    case 'session.started':
      return event.protocol === PROTOCOL
        ? { ...state, task: event.task, mode: event.mode }
        : { ...state, task: event.task, incompatible: { cli: event.protocol, page: PROTOCOL } };
    case 'session.mode':
      return { ...state, mode: event.mode };
    case 'session.model':
      return { ...state, pageModel: event.model };
    case 'decision.pending':
      return {
        ...state,
        pending: [
          ...state.pending,
          { id: event.id, runId: event.runId, round: event.round, on: event.on },
        ],
      };
    case 'decision.resolved':
      return { ...state, pending: state.pending.filter(decision => decision.id !== event.id) };
    case 'session.ended':
      return { ...state, ended: event.error === undefined ? {} : { error: event.error } };
  }
};

const reduceRun = (state: InspectorState, event: RunEvent): InspectorState => {
  switch (event.type) {
    case 'run.started':
      return {
        ...state,
        runs: [
          ...state.runs,
          {
            runId: event.runId,
            name: event.name,
            model: event.model,
            inputTokenBudget: event.inputTokenBudget,
            isGoalCheckedInCode: event.isGoalCheckedInCode,
            rounds: [],
          },
        ],
      };
    case 'round.observed':
      return updateRun(state, event.runId, run => ({
        ...run,
        rounds: [
          ...run.rounds,
          { round: event.round, context: event.context, ops: event.ops, picks: [], turns: [] },
        ],
      }));
    case 'round.goalChecked':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          goalChecked: { achieved: event.achieved, ms: event.ms },
        })),
      );
    case 'pick.started':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          picks: [...round.picks, { maxOptions: event.maxOptions }],
        })),
      );
    case 'pick.abandoned':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, ({ picked, ...round }) => ({
          ...round,
          picks: round.picks.map((pick, i) =>
            i === round.picks.length - 1
              ? { ...pick, abandoned: event.usage, ...(picked === undefined ? {} : { picked }) }
              : pick,
          ),
        })),
      );
    case 'turn.asked':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          turns: [
            ...round.turns,
            {
              turn: event.turn,
              pick: Math.max(round.picks.length, 1),
              request: event.request,
              optionInfo: event.optionInfo,
              retries: [],
              outcome: { status: 'asked' },
            },
          ],
        })),
      );
    case 'turn.retrying': {
      const retry: Turn['retries'][number] = {
        delayMs: event.delayMs,
        ...(event.status === undefined ? {} : { status: event.status }),
        ...(event.error === undefined ? {} : { error: event.error }),
      };
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({ ...turn, retries: [...turn.retries, retry] })),
        ),
      );
    }
    case 'turn.answered':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({
            ...turn,
            outcome: {
              status: 'answered',
              by: event.by,
              answers: event.answers,
              inputTokens: event.inputTokens,
              ms: event.ms,
            },
          })),
        ),
      );
    case 'turn.failed':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({
            ...turn,
            outcome: { status: 'failed', error: event.error, isTooLarge: event.isTooLarge },
          })),
        ),
      );
    case 'turn.dropped':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({
            ...turn,
            outcome: { status: 'dropped', reason: event.reason },
          })),
        ),
      );
    case 'round.picked':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          picked: {
            step: event.step,
            address: event.address,
            probabilities: event.probabilities,
            tokens: event.tokens,
            ms: event.ms,
          },
        })),
      );
    case 'step.invoked':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          invoked: {
            step: event.step,
            ms: event.ms,
            ...(event.error === undefined ? {} : { error: event.error }),
          },
        })),
      );
    case 'run.ended':
      return updateRun(state, event.runId, run => ({ ...run, result: event.result }));
  }
};

const SESSION_TYPES: ReadonlySet<string> = new Set(
  SessionEventSchema.options.map(option => option.shape.type.value),
);

const isSessionEvent = (event: InspectorEvent): event is SessionEvent =>
  SESSION_TYPES.has(event.type);

export const reduce = (state: InspectorState, event: InspectorEvent): InspectorState => {
  if (state.incompatible !== undefined) return state;
  return isSessionEvent(event) ? reduceSession(state, event) : reduceRun(state, event);
};
