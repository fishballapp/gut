import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DecisionModel } from './decision-model.ts';
import type { RunEvent } from './events.ts';
import type { RunHooks, TurnAnswer } from './inspector.ts';
import { ListStrategy } from './list-strategy.ts';
import { group, op } from './ops.ts';
import { runTask } from './task.ts';

const QuestionSchema = z.object({
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()),
});
const RequestSchema = z.object({
  state: z.record(z.string(), z.unknown()),
  questions: z.record(z.string(), QuestionSchema),
});

type Question = { state: Record<string, unknown> } & z.infer<typeof QuestionSchema>;

let decide: (question: Question) => { pick: string; probability?: number } = () => ({ pick: '' });
/** Return true to refuse this request as 413 (too large). */
let shouldRefuse: (body: string) => boolean = () => false;

const answer = (
  { criteria }: Question,
  { pick, probability = 0.9 }: { pick: string; probability?: number },
  fallback: string | undefined,
) => {
  const keys = Object.keys(criteria);
  const picked = keys.find(key => criteria[key] === pick);
  const choice = picked ?? fallback;
  if (choice === undefined) throw new Error(`no option "${pick}" in ${JSON.stringify(criteria)}`);
  const p = picked === undefined ? 0.95 : probability;
  return {
    choice,
    probabilities: Object.fromEntries(
      keys.map(key => [key, key === choice ? p : (1 - p) / (keys.length - 1)]),
    ),
  };
};

const model = ({
  name = 'fake',
  endpoint = 'http://decision-model.invalid/v1/systemone',
  apiKey,
  maxOptions = 26,
}: {
  name?: string;
  endpoint?: string;
  apiKey?: string;
  maxOptions?: number;
} = {}): DecisionModel => ({
  endpoint,
  name,
  ...(apiKey === undefined ? {} : { apiKey }),
  capabilities: { image: false, choiceQuestions: { maxOptions } },
});

const collect = () => {
  const events: RunEvent[] = [];
  const hooks = (overrides: Partial<RunHooks> = {}): RunHooks => ({
    onEvent: event => {
      events.push(event);
    },
    answer: async () => ({ by: 'model' }),
    beforePick: async () => ({ maxOptions: 26 }),
    beforeInvoke: async () => 'invoke',
    ...overrides,
  });
  return { events, hooks };
};

beforeAll(() => {
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
      if (shouldRefuse(init.body)) {
        return new Response('too large', { status: 413 });
      }
      const body = RequestSchema.parse(JSON.parse(init.body));
      const goal = body.questions.achieved && { state: body.state, ...body.questions.achieved };
      const goalAnswer = goal && answer(goal, decide(goal), 'notYet');
      const move = body.questions.next && { state: body.state, ...body.questions.next };
      const moveAnswer =
        move && answer(move, decide(move), goalAnswer?.choice === 'achieved' ? 'o1' : undefined);
      return new Response(
        JSON.stringify({
          answers: {
            ...(goalAnswer && { achieved: goalAnswer }),
            ...(moveAnswer && { next: moveAnswer }),
          },
          usage: { input_tokens: 100 },
        }),
      );
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  decide = () => ({ pick: '' });
  shouldRefuse = () => false;
});

describe('inspector hooks via runTask', () => {
  it('emits the events of a scripted run', async () => {
    const { events, hooks } = collect();
    const counter = { value: 0 };
    decide = ({ state }) => ({
      pick: state.value === 1 ? 'Goal achieved: the counter is 1' : 'Add one',
    });

    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      {},
      () => hooks(),
    );

    expect(events.map(e => e.type)).toEqual([
      'run.started',
      'round.observed',
      'pick.started',
      'turn.asked',
      'turn.answered',
      'round.picked',
      'step.invoked',
      'round.observed',
      'pick.started',
      'turn.asked',
      'turn.answered',
      'round.picked',
      'run.ended',
    ]);
    expect(events[0]).toMatchObject({
      type: 'run.started',
      model: { name: 'fake', maxOptions: 26 },
      isGoalCheckedInCode: false,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'run.ended',
      result: { status: 'achieved', steps: ['add'] },
    });
  });

  it('records a refused question as turn.failed with isTooLarge, both halves, and the final', async () => {
    const { events, hooks } = collect();
    let requests = 0;
    shouldRefuse = () => {
      requests += 1;
      return requests === 1;
    };
    decide = ({ criteria }) => {
      const descriptions = Object.values(criteria);
      return { pick: descriptions.find(d => d === 'Keep') ?? descriptions[0] ?? '' };
    };
    const done = { value: false };

    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'done' },
        ops: {
          a: op('A', () => {}),
          b: op('B', () => {}),
          c: op('C', () => {}),
          keep: op('Keep', () => {
            done.value = true;
          }),
        },
      }),
      { isGoalAchieved: () => done.value },
      () => hooks({ beforePick: async () => ({ maxOptions: 4 }) }),
    );

    const failed = events.filter(e => e.type === 'turn.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ type: 'turn.failed', isTooLarge: true });

    const answered = events.filter(e => e.type === 'turn.answered');
    // Two halves + a final between the winners (knockout of a refused 4-way).
    expect(answered).toHaveLength(3);
  });

  it('asks each knockout page and the final as their own turns', async () => {
    const { events, hooks } = collect();
    const items = Array.from({ length: 6 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ criteria }) => {
      const descriptions = Object.values(criteria);
      return {
        pick:
          descriptions.find(d => d === 'item 4') ??
          descriptions.find(d => d.includes('item 4')) ??
          descriptions[0] ??
          '',
      };
    };

    await runTask(
      { decisionModel: model({ maxOptions: 3 }) },
      'test',
      async () => ({
        context: { goal: 'item 4 is picked' },
        ops: {
          pick: op('Pick', {
            choices: items,
            strategy: ListStrategy.knockout,
            invoke: item => picked.push(item),
          }),
        },
      }),
      {
        isGoalAchieved: () => picked.includes('item 4'),
      },
      () => hooks({ beforePick: async () => ({ maxOptions: 3 }) }),
    );

    const turns = events.filter(e => e.type === 'turn.asked');
    // 6 items / 3 per page = 2 pages + 1 final.
    expect(turns.length).toBe(3);
    expect(picked).toEqual(['item 4']);
  });

  it('says what each asked option is, and where the picked step is', async () => {
    const { events, hooks } = collect();
    const items = Array.from({ length: 6 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ criteria }) => {
      const descriptions = Object.values(criteria);
      return {
        pick:
          descriptions.find(d => d === 'Pick an item' || d === 'item 4') ??
          descriptions.find(d => d.includes('item 4')) ??
          '',
      };
    };

    await runTask(
      { decisionModel: model({ maxOptions: 3 }) },
      'test',
      async () => ({
        context: { goal: 'item 4 is picked' },
        ops: {
          nav: group('Navigation', {
            home: op('Home', () => {}),
            about: op('About', () => {}),
            contact: op('Contact', () => {}),
          }),
          pick: op('Pick an item', { choices: items, invoke: item => picked.push(item) }),
          save: op('Save', () => {}),
        },
      }),
      { isGoalAchieved: () => picked.length > 0 },
      () => hooks({ beforePick: async () => ({ maxOptions: 3 }) }),
    );

    const asked = events.filter(e => e.type === 'turn.asked');
    expect(asked.map(e => e.optionInfo.next)).toEqual([
      {
        o1: { kind: 'group', address: { keys: ['nav'] }, moves: 3 },
        o2: { kind: 'choices', address: { keys: ['pick'] }, moves: 6 },
        o3: { kind: 'move', address: { keys: ['save'] } },
      },
      {
        o1: { kind: 'bundle', size: 2 },
        o2: { kind: 'bundle', size: 2 },
        o3: { kind: 'bundle', size: 2 },
      },
      {
        o1: { kind: 'move', address: { keys: ['pick'], choice: 4 } },
        o2: { kind: 'move', address: { keys: ['pick'], choice: 5 } },
      },
    ]);
    expect(events.find(e => e.type === 'round.picked')).toMatchObject({
      step: 'pick("item 4")',
      address: { keys: ['pick'], choice: 4 },
    });
  });

  it('says which option goes back out of a group', async () => {
    const { events, hooks } = collect();
    const moves = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`m${i}`, op(`Move ${i}`, () => {})]),
    );
    decide = ({ criteria }) => ({
      pick:
        Object.values(criteria).find(d => d.startsWith('Many moves')) ?? 'None of these: go back',
    });

    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { many: group('Many moves', moves), other: op('Other', () => {}) },
      }),
      { inputTokenBudget: 250 },
      () => hooks(),
    );

    const [, inside] = events.filter(e => e.type === 'turn.asked');
    const options = Object.values(inside?.optionInfo.next ?? {});
    expect(options.at(-1)).toEqual({ kind: 'back' });
    expect(options.slice(0, -1).every(option => option.kind === 'bundle')).toBe(true);
  });

  it('numbers turns from 1 in each pick: a re-pick and the next round start again at 1', async () => {
    const { events, hooks } = collect();
    const counter = { value: 0 };
    let picks = 0;
    decide = ({ state, criteria }) => {
      if (Object.values(criteria).some(d => d.startsWith('Goal achieved'))) {
        return { pick: state.value === 1 ? 'Goal achieved: the counter is 1' : 'notYet' };
      }
      return { pick: 'Add one' };
    };

    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      {},
      () =>
        hooks({
          answer: async () => {
            picks += 1;
            // Re-pick once on the first turn of round 1.
            if (picks === 1) return { repick: true };
            return { by: 'model' };
          },
        }),
    );

    const turns = events.filter(
      (e): e is Extract<RunEvent, { type: 'turn.asked' }> => e.type === 'turn.asked',
    );
    const round1 = turns.filter(e => e.round === 1).map(e => e.turn);
    const round2 = turns.filter(e => e.round === 2).map(e => e.turn);
    expect(round1).toEqual([1, 1]);
    expect(round2[0]).toBe(1);
  });

  it('lets a person answer at 0 tokens and 0 requests', async () => {
    const { events, hooks } = collect();
    const counter = { value: 0 };

    const result = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => counter.value === 1 },
      () =>
        hooks({
          answer: async ({ request }) => {
            const answers: Record<string, string> = {};
            for (const [key, question] of Object.entries(request.questions)) {
              const choice =
                Object.entries(question.criteria).find(([, text]) => text === 'Add one')?.[0] ??
                Object.keys(question.criteria)[0];
              if (choice === undefined) throw new Error('no choice');
              answers[key] = choice;
            }
            return { by: 'you', answers };
          },
        }),
    );

    expect(result).toMatchObject({
      status: 'achieved',
      usage: { inputTokens: 0, requests: 0 },
    });
    const answered = events.filter(e => e.type === 'turn.answered');
    expect(answered.every(e => e.type === 'turn.answered' && e.by.kind === 'you')).toBe(true);
    expect(answered.every(e => e.type === 'turn.answered' && e.inputTokens === 0)).toBe(true);
  });

  it('rejects invalid you answers (a missing answer, an unknown criterion, an unknown question)', async () => {
    const missing = collect();
    const missingResult = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { a: op('A', () => {}), b: op('B', () => {}) },
      }),
      { isGoalAchieved: () => false },
      () =>
        missing.hooks({
          answer: async () => ({ by: 'you', answers: {} }),
        }),
    );
    expect(missingResult).toMatchObject({
      status: 'halted',
      reason: 'error',
      error: expect.stringMatching(/missing answer/),
    });
    expect(missing.events.some(e => e.type === 'turn.failed')).toBe(true);

    const unknown = collect();
    const unknownResult = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { a: op('A', () => {}), b: op('B', () => {}) },
      }),
      { isGoalAchieved: () => false },
      () =>
        unknown.hooks({
          answer: async ({ request }) => {
            const answers: Record<string, string> = {};
            for (const key of Object.keys(request.questions)) {
              answers[key] = 'not-a-criterion';
            }
            return { by: 'you', answers };
          },
        }),
    );
    expect(unknownResult).toMatchObject({
      status: 'halted',
      reason: 'error',
      error: expect.stringMatching(/unknown criterion/),
    });
    expect(unknown.events.some(e => e.type === 'turn.failed')).toBe(true);

    const extra = collect();
    const extraResult = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { a: op('A', () => {}), b: op('B', () => {}) },
      }),
      { isGoalAchieved: () => false },
      () =>
        extra.hooks({ answer: async () => ({ by: 'you', answers: { next: 'o1', bogus: 'o1' } }) }),
    );
    expect(extraResult).toMatchObject({
      status: 'halted',
      reason: 'error',
      error: expect.stringMatching(/unknown question "bogus"/),
    });
  });

  it('lets the model then you answer within one round', async () => {
    const { events, hooks } = collect();
    const items = Array.from({ length: 4 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    let turns = 0;
    decide = ({ criteria }) => {
      const descriptions = Object.values(criteria);
      return {
        pick: descriptions.find(d => d.includes('item 0') || d.includes('item 1')) ?? '',
      };
    };

    await runTask(
      { decisionModel: model({ maxOptions: 2 }) },
      'test',
      async () => ({
        context: { goal: 'picked' },
        ops: {
          pick: op('Pick', {
            choices: items,
            strategy: ListStrategy.knockout,
            invoke: item => picked.push(item),
          }),
        },
      }),
      { isGoalAchieved: () => picked.length > 0 },
      () =>
        hooks({
          beforePick: async () => ({ maxOptions: 2 }),
          answer: async ({ request }): Promise<TurnAnswer> => {
            turns += 1;
            if (turns === 1) return { by: 'model' };
            const answers: Record<string, string> = {};
            for (const [key, question] of Object.entries(request.questions)) {
              const choice =
                Object.entries(question.criteria).find(([, text]) => text === 'item 0')?.[0] ??
                Object.keys(question.criteria)[0];
              if (choice === undefined) throw new Error('no choice');
              answers[key] = choice;
            }
            return { by: 'you', answers };
          },
        }),
    );

    const answered = events.filter(
      (e): e is Extract<RunEvent, { type: 'turn.answered' }> => e.type === 'turn.answered',
    );
    expect(answered.map(e => e.by.kind)).toEqual(expect.arrayContaining(['model', 'you']));
    expect(answered[0]?.by.kind).toBe('model');
    expect(answered.some(e => e.by.kind === 'you')).toBe(true);
  });

  it('accepts a model from answer when the run has none, and names it in turn.answered', async () => {
    const { events, hooks } = collect();
    const pageModel = model({ name: 'from-page', endpoint: 'http://page.invalid/v1/systemone' });
    decide = () => ({ pick: 'Go' });
    const done = { value: false };

    await runTask(
      { decisionModel: null },
      'test',
      async () => ({
        context: { goal: 'done' },
        ops: {
          go: op('Go', () => {
            done.value = true;
          }),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => done.value },
      () =>
        hooks({
          answer: async () => ({ by: 'model', model: pageModel }),
        }),
    );

    const answered = events.find(e => e.type === 'turn.answered');
    expect(answered).toMatchObject({
      type: 'turn.answered',
      by: { kind: 'model', name: 'from-page', endpoint: 'http://page.invalid/v1/systemone' },
    });
  });

  it('throws a clear error when the model is smaller than the question', async () => {
    const { events, hooks } = collect();
    const result = await runTask(
      { decisionModel: null },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: {
          a: op('A', () => {}),
          b: op('B', () => {}),
          c: op('C', () => {}),
        },
      }),
      { isGoalAchieved: () => false },
      () =>
        hooks({
          beforePick: async () => ({ maxOptions: 3 }),
          answer: async () => ({
            by: 'model',
            model: model({ maxOptions: 2 }),
          }),
        }),
    );
    expect(result).toMatchObject({
      status: 'halted',
      reason: 'error',
      error: expect.stringMatching(/at most 2/),
    });
    expect(events.some(e => e.type === 'turn.failed' && e.isTooLarge === false)).toBe(true);
  });

  it('does not stall when beforeInvoke re-picks three times on the same step, then invokes', async () => {
    const { events, hooks } = collect();
    const counter = { value: 0 };
    let invokes = 0;
    decide = () => ({ pick: 'Add one' });

    const result = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => counter.value === 1 },
      () =>
        hooks({
          beforeInvoke: async () => {
            invokes += 1;
            return invokes <= 3 ? 'repick' : 'invoke';
          },
        }),
    );

    expect(result.status).toBe('achieved');
    expect(result).not.toMatchObject({ reason: 'stalled' });
    expect(events.filter(e => e.type === 'pick.abandoned')).toHaveLength(3);
    expect(events.some(e => e.type === 'step.invoked')).toBe(true);
  });

  it('reports pick.abandoned.usage per pick across two abandoned picks', async () => {
    const { events, hooks } = collect();
    const counter = { value: 0 };
    let abandons = 0;
    decide = () => ({ pick: 'Add one' });

    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => counter.value === 1 },
      () =>
        hooks({
          beforeInvoke: async () => {
            abandons += 1;
            return abandons <= 2 ? 'repick' : 'invoke';
          },
        }),
    );

    const abandoned = events.filter(
      (e): e is Extract<RunEvent, { type: 'pick.abandoned' }> => e.type === 'pick.abandoned',
    );
    expect(abandoned).toHaveLength(2);
    expect(abandoned.map(e => e.usage)).toEqual([
      { inputTokens: 100, requests: 1 },
      { inputTokens: 100, requests: 1 },
    ]);
  });

  it('ends a model turn as halted: budget, while you turns go on past the budget', async () => {
    decide = () => ({ pick: 'Add' });

    const modelRun = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { add: op('Add', () => {}), other: op('Other', () => {}) },
      }),
      { inputTokenBudget: 100 },
    );
    expect(modelRun).toMatchObject({ status: 'halted', reason: 'budget' });

    const { hooks } = collect();
    const counter = { value: 0 };
    const youRun = await runTask(
      { decisionModel: model() },
      'test',
      async () => ({
        context: { goal: 'the counter is 2', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => counter.value === 2, inputTokenBudget: 0 },
      () =>
        hooks({
          answer: async ({ request }) => {
            const answers: Record<string, string> = {};
            for (const [key, question] of Object.entries(request.questions)) {
              const choice =
                Object.entries(question.criteria).find(([, text]) => text === 'Add one')?.[0] ??
                Object.keys(question.criteria)[0];
              if (choice === undefined) throw new Error('no choice');
              answers[key] = choice;
            }
            return { by: 'you', answers };
          },
        }),
    );
    expect(youRun).toMatchObject({
      status: 'achieved',
      usage: { inputTokens: 0, requests: 0 },
    });
  });

  it('never puts an apiKey in any event', async () => {
    const { events, hooks } = collect();
    decide = () => ({ pick: 'Go' });
    const done = { value: false };

    await runTask(
      {
        decisionModel: model({ apiKey: 'secret-key', name: 'keyed' }),
      },
      'test',
      async () => ({
        context: { goal: 'done' },
        ops: {
          go: op('Go', () => {
            done.value = true;
          }),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => done.value },
      () =>
        hooks({
          answer: async () => ({
            by: 'model',
            model: model({ apiKey: 'page-secret', name: 'page' }),
          }),
        }),
    );

    const blob = JSON.stringify(events);
    expect(blob).not.toContain('secret-key');
    expect(blob).not.toContain('page-secret');
    expect(blob).not.toContain('apiKey');
  });
  it('never puts an apiKey in an event when the server echoes it in an error', async () => {
    const { events, hooks } = collect();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid key secret-key', { status: 401 }));
    const configured = await runTask(
      { decisionModel: model({ apiKey: 'secret-key' }) },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { a: op('A', () => {}), b: op('B', () => {}) },
      }),
      { isGoalAchieved: () => false },
      () => hooks(),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('invalid key page-secret', { status: 401 }),
    );
    const supplied = await runTask(
      { decisionModel: null },
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: { a: op('A', () => {}), b: op('B', () => {}) },
      }),
      { isGoalAchieved: () => false },
      () =>
        hooks({ answer: async () => ({ by: 'model', model: model({ apiKey: 'page-secret' }) }) }),
    );

    expect(configured).toMatchObject({ status: 'halted', reason: 'error' });
    expect(supplied).toMatchObject({ status: 'halted', reason: 'error' });
    const blob = JSON.stringify([events, configured, supplied]);
    expect(blob).toContain('invalid key [apiKey]');
    expect(blob).not.toContain('secret-key');
    expect(blob).not.toContain('page-secret');
  });

  it('ends every asked turn exactly once: answered, failed or dropped', async () => {
    const endings = (events: readonly RunEvent[]) => {
      // Turns are numbered within a pick, so a turn is its round, its pick and its number.
      const byTurn = new Map<string, string[]>();
      let pick = 0;
      for (const event of events) {
        if (event.type === 'pick.started') pick += 1;
        if (!('turn' in event)) continue;
        const key = `${event.round}.${pick}.${event.turn}`;
        byTurn.set(key, [...(byTurn.get(key) ?? []), event.type]);
      }
      return [...byTurn.values()].map(types =>
        types.filter(type => type !== 'turn.asked' && type !== 'turn.retrying'),
      );
    };
    const ops = { a: op('A', () => {}), b: op('B', () => {}) };

    // A re-pick drops the pending turn; the next pick's turn is answered.
    const repick = collect();
    let answered = 0;
    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({ context: { goal: 'never' }, ops }),
      { isGoalAchieved: () => answered > 1 },
      () =>
        repick.hooks({
          answer: async () => {
            answered += 1;
            return answered === 1 ? { repick: true } : { by: 'you', answers: { next: 'o1' } };
          },
        }),
    );
    expect(repick.events).toContainEqual(
      expect.objectContaining({ type: 'turn.dropped', reason: 'repick' }),
    );
    expect(endings(repick.events).every(types => types.length === 1)).toBe(true);

    // A spent budget drops the model's turn.
    const budget = collect();
    await runTask(
      { decisionModel: model() },
      'test',
      async () => ({ context: { goal: 'never' }, ops }),
      { isGoalAchieved: () => false, inputTokenBudget: 0 },
      () => budget.hooks(),
    );
    expect(budget.events).toContainEqual(
      expect.objectContaining({ type: 'turn.dropped', reason: 'budget' }),
    );
    expect(endings(budget.events)).toEqual([['turn.dropped']]);

    // A model from the inspector that isn't a valid model fails its turn.
    const invalid = collect();
    const invalidResult = await runTask(
      { decisionModel: null },
      'test',
      async () => ({ context: { goal: 'never' }, ops }),
      { isGoalAchieved: () => false },
      () =>
        invalid.hooks({
          answer: async () => ({ by: 'model', model: { ...model(), endpoint: 'not a url' } }),
        }),
    );
    expect(invalidResult).toMatchObject({ status: 'halted', reason: 'error' });
    expect(endings(invalid.events)).toEqual([['turn.failed']]);
  });
});
