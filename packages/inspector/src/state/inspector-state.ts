// What the page knows: a pure function of the ordered event stream the CLI serves. Every run, round
// and turn is kept, answered or not, so any of them can be opened during or after the run.
import type {
  Edit,
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

/** A turn of the round's current pick: a re-pick drops the turns from where it starts. */
export type Turn = {
  turn: number;
  /** The edits the pick this turn belongs to was made with; none for a pick as the task wrote it. */
  edits: readonly Edit[];
  /** The state and questions exactly as sent. */
  request: EventOf<'turn.asked'>['request'];
  /** By question key, then criterion key: what each option is. */
  optionInfo: Record<string, Record<string, OptionInfo>>;
  retries: Omit<EventOf<'turn.retrying'>, 'type' | 'runId' | 'round' | 'turn'>[];
  /** The model's answer, held for you to keep or drop; kept with the answer once you keep it. */
  suggestion?: Omit<EventOf<'turn.suggested'>, 'type' | 'runId' | 'round' | 'turn'>;
  outcome:
    | { status: 'asked' }
    | ({ status: 'answered' } & Omit<EventOf<'turn.answered'>, 'type' | 'runId' | 'round' | 'turn'>)
    | { status: 'failed'; error: string; isTooLarge: boolean }
    | { status: 'dropped'; reason: 'budget' };
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
  /** What the developer changed of what the model read, for this pick. */
  edits: readonly Edit[];
};

export type Round = {
  round: number;
  context: Extract<RunEvent, { type: 'round.observed' }>['context'];
  ops: OpTreeNode[];
  goalChecked?: { achieved: boolean; ms: number };
  picks: Pick[];
  turns: Turn[];
  /** What the model was asked for answers no longer in the record: dropped in review, or by a re-pick. */
  dropped: Usage;
  /** The current pick's step; a re-pick drops it. */
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
  /** Counts the sessions the record has begun: a restart begins the next one. */
  sessionNumber: number;
  mode: Mode;
  /** The model set in the page, for runs without their own. */
  pageModel: ModelInfo | null;
  /** The question size the developer chose; null until they choose one. */
  maxOptions: number | null;
  runs: Run[];
  /** Decisions the runs wait on, oldest first. */
  pending: Decision[];
  /** Set once the task's top-level code finished or threw. */
  ended?: { error?: string };
  /** The CLI speaks another protocol than this page: nothing after `session.started` is read. */
  incompatible?: { cli: number; page: number };
};

export const initialState: InspectorState = {
  sessionNumber: 0,
  mode: 'step',
  pageModel: null,
  maxOptions: null,
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

const NOTHING: Usage = { inputTokens: 0, requests: 0 };

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  requests: a.requests + b.requests,
});

/** What the model was asked for a turn's answer: the one it suggested, else the one it gave. */
export const turnSpend = (turn: Turn): Usage => {
  const asked =
    turn.suggestion ??
    (turn.outcome.status === 'answered' && turn.outcome.by.kind === 'model'
      ? turn.outcome
      : undefined);
  return asked === undefined ? NOTHING : { inputTokens: asked.inputTokens, requests: 1 };
};

/** Drops the turns `isDropped` names, keeping what the model was asked for them. */
const dropTurns = (round: Round, isDropped: (turn: Turn) => boolean): Round => ({
  ...round,
  turns: round.turns.filter(turn => !isDropped(turn)),
  dropped: round.turns.filter(isDropped).map(turnSpend).reduce(addUsage, round.dropped),
});

const reduceSession = (state: InspectorState, event: SessionEvent): InspectorState => {
  switch (event.type) {
    // The first one starts the record; a later one is a restart, which begins it afresh (the model
    // set in the page follows, as its own event).
    case 'session.started': {
      const fresh = {
        ...initialState,
        sessionNumber: state.sessionNumber + 1,
        task: event.task,
        mode: event.mode,
      };
      return event.protocol === PROTOCOL
        ? fresh
        : { ...fresh, incompatible: { cli: event.protocol, page: PROTOCOL } };
    }
    case 'session.mode':
      return { ...state, mode: event.mode };
    case 'session.model':
      return { ...state, pageModel: event.model };
    case 'session.maxOptions':
      return { ...state, maxOptions: event.maxOptions };
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
          {
            round: event.round,
            context: event.context,
            ops: event.ops,
            picks: [],
            turns: [],
            dropped: NOTHING,
          },
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
          picks: [...round.picks, { maxOptions: event.maxOptions, edits: event.edits }],
        })),
      );
    // The turns before `fromTurn` stay: the next pick answers them as they were.
    case 'pick.abandoned':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, ({ picked: _, ...round }) =>
          dropTurns(round, turn => turn.turn >= event.fromTurn),
        ),
      );
    case 'turn.asked':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => ({
          ...round,
          turns: [
            ...round.turns,
            {
              turn: event.turn,
              edits: round.picks.at(-1)?.edits ?? [],
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
    case 'turn.suggested':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({
            ...turn,
            suggestion: {
              by: event.by,
              answers: event.answers,
              inputTokens: event.inputTokens,
              ms: event.ms,
            },
          })),
        ),
      );
    case 'turn.reopened':
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round => {
          const turn = round.turns.find(entry => entry.turn === event.turn);
          const spent = turn === undefined ? NOTHING : turnSpend(turn);
          return updateTurn(
            { ...round, dropped: addUsage(round.dropped, spent) },
            event.turn,
            ({ suggestion: _, ...turn }) => turn,
          );
        }),
      );
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
    case 'turn.dropped': {
      const { reason } = event;
      // A re-pick's turns leave the record with the pick it abandons.
      if (reason === 'repick') {
        return updateRun(state, event.runId, run =>
          updateRound(run, event.round, round =>
            dropTurns(round, turn => turn.turn === event.turn),
          ),
        );
      }
      return updateRun(state, event.runId, run =>
        updateRound(run, event.round, round =>
          updateTurn(round, event.turn, turn => ({
            ...turn,
            outcome: { status: 'dropped', reason },
          })),
        ),
      );
    }
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
