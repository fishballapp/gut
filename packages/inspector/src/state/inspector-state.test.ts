import { initGut, op } from '@gut.run/core';
import {
  type Edit,
  INSPECTOR_KEY,
  type InspectorEvent,
  type InspectorGlobal,
  PROTOCOL,
  type RunHooks,
  type TurnAnswer,
} from '@gut.run/core/inspector';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type InspectorState, initialState, reduce } from './inspector-state.ts';

const RequestSchema = z.object({ questions: z.record(z.string(), z.unknown()) });

/** A model that always picks the first option, and says the goal is not met. */
const fakeModel = vi.fn<typeof fetch>(async (_input, init) => {
  if (typeof init?.body !== 'string') throw new Error('expected a JSON body');
  const { questions } = RequestSchema.parse(JSON.parse(init.body));
  const answers = Object.fromEntries(
    Object.keys(questions).map(key => {
      const choice = key === 'achieved' ? 'notYet' : 'o1';
      return [key, { choice, probabilities: { [choice]: 0.8 } }];
    }),
  );
  return new Response(JSON.stringify({ answers, usage: { input_tokens: 100 } }));
});

beforeEach(() => {
  vi.stubGlobal('fetch', fakeModel);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, INSPECTOR_KEY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs a two-round task under hooks that answer each turn as `answerFor` says, recording events. */
const record = async (
  answerFor: (turn: number, round: number) => TurnAnswer,
  beforeInvoke: RunHooks['beforeInvoke'] = async () => 'invoke',
  review: RunHooks['review'] = async () => ({ by: 'model' }),
) => {
  const events: InspectorEvent[] = [];
  const inspector: InspectorGlobal = {
    protocol: PROTOCOL,
    attach: (): RunHooks => ({
      onEvent: event => events.push(event),
      answer: async ({ round, turn }) => answerFor(turn, round),
      review,
      beforePick: async () => ({ maxOptions: 26, edits: [] }),
      beforeInvoke,
    }),
  };
  Reflect.set(globalThis, INSPECTOR_KEY, inspector);
  const counter = { value: 0 };
  const { runTask } = await initGut({
    config: {
      decisionModel: { endpoint: 'http://decision-model.invalid/v1/systemone', name: 'fake' },
    },
  });
  await runTask(
    'count to 2',
    async () => ({
      context: { goal: 'the counter is 2', value: counter.value },
      ops: {
        add: op('Add one', () => {
          counter.value += 1;
        }),
        reset: op('Reset', () => {
          counter.value = 0;
        }),
      },
    }),
    { isGoalAchieved: () => counter.value === 2 },
  );
  return events;
};

describe('reduce', () => {
  it('rebuilds every run, round and turn from the stream', async () => {
    const events = await record(() => ({ by: 'model' }));
    const state = events.reduce(reduce, initialState);
    expect(state.runs).toHaveLength(1);
    const [run] = state.runs;
    expect(run).toMatchObject({
      name: 'count to 2',
      model: { name: 'fake', maxOptions: 255 },
      isGoalCheckedInCode: true,
      result: { status: 'achieved', steps: ['add', 'add'] },
    });
    expect(run?.rounds.map(round => round.picked?.step)).toEqual(['add', 'add', undefined]);
    expect(run?.rounds[0]?.turns).toEqual([
      expect.objectContaining({
        turn: 1,
        edits: [],
        optionInfo: {
          next: {
            o1: { kind: 'move', address: { keys: ['add'] } },
            o2: { kind: 'move', address: { keys: ['reset'] } },
          },
        },
        outcome: expect.objectContaining({
          status: 'answered',
          by: {
            kind: 'model',
            name: 'fake',
            endpoint: 'http://decision-model.invalid/v1/systemone',
          },
          inputTokens: 100,
        }),
      }),
    ]);
    expect(run?.rounds[2]?.goalChecked).toMatchObject({ achieved: true });
  });

  it('drops the turns of a pick a re-pick abandons, and starts again at turn 1', async () => {
    let hasRepicked = false;
    const events = await record(() => {
      if (hasRepicked) return { by: 'model' };
      hasRepicked = true;
      return { repickFrom: 1 };
    });
    const firstRound = events.reduce(reduce, initialState).runs[0]?.rounds[0];
    expect(firstRound?.picks).toEqual([
      { maxOptions: 26, edits: [] },
      { maxOptions: 26, edits: [] },
    ]);
    expect(firstRound?.turns.map(turn => [turn.turn, turn.outcome.status])).toEqual([
      [1, 'answered'],
    ]);
  });

  it('drops the step a re-pick abandons, and what the model spent on it counts as dropped', async () => {
    let isFirst = true;
    const events = await record(
      () => ({ by: 'model' }),
      async () => {
        const action = isFirst ? { repickFrom: 1 } : 'invoke';
        isFirst = false;
        return action;
      },
    );
    const abandonedAt = events.findIndex(event => event.type === 'pick.abandoned');
    const afterAbandon = events.slice(0, abandonedAt + 1).reduce(reduce, initialState);
    const round = afterAbandon.runs[0]?.rounds[0];
    expect(round?.picked).toBeUndefined();
    expect(round?.turns).toEqual([]);
    expect(round?.dropped).toEqual({ inputTokens: 100, requests: 1 });
  });

  it('keeps the turns before where a re-pick starts', () => {
    const by = { kind: 'model', name: 'fake', endpoint: 'http://x' } as const;
    const answers = { next: { choice: 'o1', probabilities: { o1: 0.8 } } };
    const request = { state: { goal: 'g' }, questions: {} };
    const asked = (turn: number): InspectorEvent => ({
      type: 'turn.asked',
      runId: 'r1',
      round: 1,
      turn,
      request,
      optionInfo: {},
    });
    const state = (
      [
        {
          type: 'run.started',
          runId: 'r1',
          name: 'n',
          model: null,
          inputTokenBudget: 1000,
          isGoalCheckedInCode: false,
        },
        { type: 'round.observed', runId: 'r1', round: 1, context: { goal: 'g' }, ops: [] },
        { type: 'pick.started', runId: 'r1', round: 1, maxOptions: 26, edits: [] },
        asked(1),
        {
          type: 'turn.answered',
          runId: 'r1',
          round: 1,
          turn: 1,
          by,
          answers,
          inputTokens: 100,
          ms: 1,
        },
        asked(2),
        {
          type: 'turn.answered',
          runId: 'r1',
          round: 1,
          turn: 2,
          by,
          answers,
          inputTokens: 100,
          ms: 1,
        },
        asked(3),
        {
          type: 'turn.suggested',
          runId: 'r1',
          round: 1,
          turn: 3,
          by,
          answers,
          inputTokens: 100,
          ms: 1,
        },
        { type: 'turn.dropped', runId: 'r1', round: 1, turn: 3, reason: 'repick' },
        {
          type: 'pick.abandoned',
          runId: 'r1',
          round: 1,
          fromTurn: 2,
          usage: { inputTokens: 300, requests: 3 },
        },
        { type: 'pick.started', runId: 'r1', round: 1, maxOptions: 26, edits: [] },
        asked(2),
      ] satisfies InspectorEvent[]
    ).reduce(reduce, initialState);
    const round = state.runs[0]?.rounds[0];
    expect(round?.turns.map(turn => [turn.turn, turn.outcome.status])).toEqual([
      [1, 'answered'],
      [2, 'asked'],
    ]);
    expect(round?.dropped).toEqual({ inputTokens: 200, requests: 2 });
  });

  it('keeps the edits a pick was made with, and marks the turns asked under them', () => {
    const edits: Edit[] = [{ kind: 'description', keys: ['add'], description: 'Add two' }];
    const state = [
      {
        type: 'run.started',
        runId: 'r1',
        name: 'counter',
        model: null,
        inputTokenBudget: 1000,
        isGoalCheckedInCode: false,
      },
      { type: 'round.observed', runId: 'r1', round: 1, context: { goal: 'done' }, ops: [] },
      { type: 'pick.started', runId: 'r1', round: 1, maxOptions: 26, edits: [] },
      { type: 'pick.started', runId: 'r1', round: 1, maxOptions: 26, edits },
      {
        type: 'turn.asked',
        runId: 'r1',
        round: 1,
        turn: 1,
        request: { state: { goal: 'done' }, questions: {} },
        optionInfo: {},
      },
    ].reduce<InspectorState>(
      (current, event) => reduce(current, event as InspectorEvent),
      initialState,
    );
    const [round] = state.runs[0]?.rounds ?? [];
    expect(round?.picks.map(pick => pick.edits)).toEqual([[], edits]);
    expect(round?.turns[0]?.edits).toEqual(edits);
  });

  it('reads nothing after a session that speaks another protocol', () => {
    const started: InspectorEvent = {
      type: 'session.started',
      protocol: PROTOCOL + 1,
      task: 'task.gut.ts',
      mode: 'step',
    };
    const state = [started, { type: 'session.mode', mode: 'play' } as const].reduce(
      reduce,
      initialState,
    );
    expect(state.incompatible).toEqual({ cli: PROTOCOL + 1, page: PROTOCOL });
    expect(state.mode).toBe('step');
  });

  it('begins the record afresh on a restart, keeping only the task and the mode', () => {
    const events: InspectorEvent[] = [
      { type: 'session.started', protocol: PROTOCOL, task: 'task.gut.ts', mode: 'play' },
      {
        type: 'session.model',
        model: { name: 'jev', endpoint: 'https://x.invalid', maxOptions: 255 },
      },
      {
        type: 'run.started',
        runId: 'r1',
        name: 'first',
        model: null,
        inputTokenBudget: 100,
        isGoalCheckedInCode: false,
      },
      {
        type: 'decision.pending',
        id: 'd1',
        runId: 'r1',
        round: 1,
        on: { kind: 'step', step: 'add' },
      },
      { type: 'session.ended', error: 'boom' },
      { type: 'session.started', protocol: PROTOCOL, task: 'task.gut.ts', mode: 'play' },
    ];
    const state = events.reduce(reduce, initialState);
    expect(state).toEqual({
      sessionNumber: 2,
      task: 'task.gut.ts',
      mode: 'play',
      pageModel: null,
      maxOptions: null,
      runs: [],
      pending: [],
    });
  });

  it('keeps the latest chosen size, and a restart begins without one until the CLI repeats it', () => {
    const started: InspectorEvent = {
      type: 'session.started',
      protocol: PROTOCOL,
      task: 'task.gut.ts',
      mode: 'step',
    };
    const chosen: InspectorEvent = { type: 'session.maxOptions', maxOptions: 9 };
    const earlier: InspectorEvent = { type: 'session.maxOptions', maxOptions: 12 };
    expect([started, earlier, chosen].reduce(reduce, initialState).maxOptions).toBe(9);
    expect([started, chosen, started].reduce(reduce, initialState).maxOptions).toBe(null);
    expect([started, chosen, started, chosen].reduce(reduce, initialState).maxOptions).toBe(9);
  });

  it('records a turn a person answered', async () => {
    const events = await record(() => ({ by: 'you', answers: { next: 'o1' } }));
    const turn = events.reduce(reduce, initialState).runs[0]?.rounds[0]?.turns[0];
    expect(turn?.outcome).toMatchObject({
      status: 'answered',
      by: { kind: 'you' },
      inputTokens: 0,
    });
  });

  it("keeps the model's answer on the turn while it waits for review, and drops it on reopen", async () => {
    let asks = 0;
    const events = await record(
      () => {
        asks += 1;
        return asks === 1
          ? { by: 'model', shouldReview: true }
          : { by: 'you', answers: { next: 'o2' } };
      },
      undefined,
      async () => ({ reopen: true }),
    );
    const suggestedAt = events.findIndex(event => event.type === 'turn.suggested');
    const waiting = events.slice(0, suggestedAt + 1).reduce(reduce, initialState);
    const held = waiting.runs[0]?.rounds[0]?.turns[0];
    expect(held?.outcome.status).toBe('asked');
    expect(held?.suggestion).toMatchObject({
      by: { kind: 'model', name: 'fake' },
      inputTokens: 100,
    });

    const reopenedAt = events.findIndex(event => event.type === 'turn.reopened');
    const reopened = events.slice(0, reopenedAt + 1).reduce(reduce, initialState);
    const round = reopened.runs[0]?.rounds[0];
    expect(round?.turns[0]?.suggestion).toBeUndefined();
    expect(round?.dropped).toEqual({ inputTokens: 100, requests: 1 });

    const turn = events.reduce(reduce, initialState).runs[0]?.rounds[0]?.turns[0];
    expect(turn?.outcome).toMatchObject({
      status: 'answered',
      by: { kind: 'you' },
      inputTokens: 0,
    });
  });

  it('tracks the session: mode, page model and what waits', () => {
    const events: InspectorEvent[] = [
      { type: 'session.started', protocol: PROTOCOL, task: 'task.gut.ts', mode: 'step' },
      {
        type: 'decision.pending',
        id: 'd1',
        runId: 'r1',
        round: 1,
        on: { kind: 'turn', turn: 1, isReview: false },
      },
      {
        type: 'session.model',
        model: { name: 'jev', endpoint: 'https://x.invalid', maxOptions: 255 },
      },
      { type: 'session.mode', mode: 'play' },
      { type: 'decision.resolved', id: 'd1', by: 'model' },
      { type: 'session.ended' },
    ];
    const states = events.map((_, i) => events.slice(0, i + 1).reduce(reduce, initialState));
    expect(states[1]?.pending).toEqual([
      { id: 'd1', runId: 'r1', round: 1, on: { kind: 'turn', turn: 1, isReview: false } },
    ]);
    expect(states.at(-1)).toEqual({
      sessionNumber: 1,
      task: 'task.gut.ts',
      mode: 'play',
      pageModel: { name: 'jev', endpoint: 'https://x.invalid', maxOptions: 255 },
      maxOptions: null,
      runs: [],
      pending: [],
      ended: {},
    });
  });
});
