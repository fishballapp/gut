import { initGut, op } from '@gut.run/core';
import {
  INSPECTOR_KEY,
  type InspectorEvent,
  type InspectorGlobal,
  PROTOCOL,
  type RunHooks,
  type TurnAnswer,
} from '@gut.run/core/inspector';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { initialState, reduce } from './inspector-state.ts';

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
) => {
  const events: InspectorEvent[] = [];
  const inspector: InspectorGlobal = {
    protocol: PROTOCOL,
    attach: (): RunHooks => ({
      onEvent: event => events.push(event),
      answer: async ({ round, turn }) => answerFor(turn, round),
      beforePick: async () => ({ maxOptions: 26 }),
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

  it("drops the turns of a pick a re-pick abandons, and keeps the pick's spend", async () => {
    let hasRepicked = false;
    const events = await record(() => {
      if (hasRepicked) return { by: 'model' };
      hasRepicked = true;
      return { repick: true };
    });
    const firstRound = events.reduce(reduce, initialState).runs[0]?.rounds[0];
    expect(firstRound?.picks).toEqual([
      { maxOptions: 26, abandoned: { inputTokens: 0, requests: 0 } },
      { maxOptions: 26 },
    ]);
    // The pick after a re-pick starts again at turn 1.
    expect(firstRound?.turns.map(turn => [turn.turn, turn.outcome.status])).toEqual([
      [1, 'answered'],
    ]);
  });

  it('moves a picked step to its pick when Pick again abandons it', async () => {
    let isFirst = true;
    const events = await record(
      () => ({ by: 'model' }),
      async () => {
        const action = isFirst ? 'repick' : 'invoke';
        isFirst = false;
        return action;
      },
    );
    const firstRound = events.reduce(reduce, initialState).runs[0]?.rounds[0];
    expect(firstRound?.picks[0]).toMatchObject({
      abandoned: { inputTokens: 100, requests: 1 },
      picked: { step: 'add', address: { keys: ['add'] } },
    });
    expect(firstRound?.picks[1]?.picked).toBeUndefined();
    expect(firstRound?.picked).toMatchObject({ step: 'add' });
    expect(firstRound?.turns.map(turn => turn.turn)).toEqual([1]);
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
      runs: [],
      pending: [],
    });
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

  it('tracks the session: mode, page model and what waits', () => {
    const events: InspectorEvent[] = [
      { type: 'session.started', protocol: PROTOCOL, task: 'task.gut.ts', mode: 'step' },
      {
        type: 'decision.pending',
        id: 'd1',
        runId: 'r1',
        round: 1,
        on: { kind: 'turn', turn: 1 },
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
      { id: 'd1', runId: 'r1', round: 1, on: { kind: 'turn', turn: 1 } },
    ]);
    expect(states.at(-1)).toEqual({
      sessionNumber: 1,
      task: 'task.gut.ts',
      mode: 'play',
      pageModel: { name: 'jev', endpoint: 'https://x.invalid', maxOptions: 255 },
      runs: [],
      pending: [],
      ended: {},
    });
  });
});
