import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { group, ListStrategy, op, task } from './index.ts';

const QuestionSchema = z.object({
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()),
});
const RequestSchema = z.object({
  state: z.record(z.string(), z.unknown()),
  questions: z.record(z.string(), QuestionSchema),
});

type Question = { state: Record<string, unknown> } & z.infer<typeof QuestionSchema>;

// An entirely offline decision model. `decide` returns the description to pick, and how sure it
// is; returning "Goal achieved: …" meets the goal, and any other pick answers "not yet".
let decide: (question: Question) => { pick: string; probability?: number } = () => ({ pick: '' });
const questions: Question[] = []; // the move questions, in order
const requests: z.infer<typeof RequestSchema>[] = []; // answered ones
const refusals: string[] = []; // bodies refused as too large

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

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gut-'));
  await writeFile(
    join(dir, 'gut.config.json'),
    JSON.stringify({
      decisionModel: { endpoint: 'http://decision-model.invalid/v1/systemone', name: 'fake' },
    }),
  );
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (_input, init) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
      // Like Ollama, refuse a text-only body over 64 KiB.
      if (new TextEncoder().encode(init.body).length > 64 * 1024) {
        refusals.push(init.body);
        return new Response(
          JSON.stringify({ error: 'request body must not exceed 64 KiB without images' }),
          { status: 413 },
        );
      }
      const body = RequestSchema.parse(JSON.parse(init.body));
      requests.push(body);
      const goal = body.questions.achieved && { state: body.state, ...body.questions.achieved };
      const goalAnswer = goal && answer(goal, decide(goal), 'notYet');
      const move = body.questions.next && { state: body.state, ...body.questions.next };
      if (move) questions.push(move);
      // Once the goal is met, the move question's answer is ignored.
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
  return () => rm(dir, { recursive: true, force: true });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  questions.length = 0;
  requests.length = 0;
  refusals.length = 0;
});

describe('task', () => {
  it('runs the picked op, then stops when the model picks the goal', async () => {
    const counter = { value: 0 };
    decide = ({ state }) => ({
      pick: state.value === 1 ? 'Goal achieved: the counter is 1' : 'Add one to the counter',
    });

    const result = await task(async () => ({
      context: { goal: 'the counter is 1', value: counter.value },
      ops: [
        op({ id: 'add', description: 'Add one to the counter', invoke: () => counter.value++ }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['add'] });
    expect(counter.value).toBe(1);
    // One op leaves nothing to choose, so each tick asks the goal alone before its step runs.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([['achieved'], ['achieved']]);
  });

  it('asks a list too long for one question part by part', async () => {
    const items = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ state, criteria }) => {
      if (state.picked !== null) return { pick: 'Goal achieved: item 42 is picked' };
      const descriptions = Object.values(criteria);
      return {
        pick:
          descriptions.find(d => d === 'item 42') ??
          descriptions.find(d => d.startsWith('Contains:') && d.split(', ').includes('item 42')) ??
          descriptions.find(d => d.startsWith('Contains: item 40')) ??
          'Pick an item',
      };
    };

    const result = await task(async () => ({
      context: { goal: 'item 42 is picked', picked: picked[0] ?? null },
      ops: [
        op({
          id: 'pick',
          description: 'Pick an item',
          choices: items,
          invoke: item => picked.push(item),
        }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 42")'] });
    expect(picked).toEqual(['item 42']);
    // Tick 1: the goal rides with the first question, a part of the list (the one op isn't
    // asked), then the item. Tick 2: the goal with the first question again, now met.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([
      ['achieved', 'next'],
      ['next'],
      ['achieved', 'next'],
    ]);
    expect(questions.map(q => Object.keys(q.criteria).length)).toEqual([25, 4, 25]);
  });

  it("asks an op's choices by the strategy the op names", async () => {
    const items = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ state, criteria }) => {
      if (state.picked !== null) return { pick: 'Goal achieved: item 42 is picked' };
      const descriptions = Object.values(criteria);
      const offered = descriptions.filter(d => d.startsWith('item '));
      return { pick: offered.find(d => d === 'item 42') ?? offered[0] ?? 'not an item' };
    };

    const result = await task(async () => ({
      context: { goal: 'item 42 is picked', picked: picked[0] ?? null },
      ops: [
        op({
          id: 'pick',
          description: 'Pick an item',
          choices: items,
          strategy: ListStrategy.knockout,
          invoke: item => picked.push(item),
        }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 42")'] });
    // Pages of 26 real items, then the four page winners; no bundles. Tick 2 meets the goal with
    // its first page.
    expect(questions.map(q => Object.keys(q.criteria).length)).toEqual([26, 26, 26, 22, 4, 26]);
    expect(
      questions.flatMap(q => Object.values(q.criteria)).some(d => d.startsWith('Contains:')),
    ).toBe(false);
  });

  it('hides an op whose choices are empty, and a falsy entry', async () => {
    decide = () => ({ pick: 'Wait' });

    await task(async () => ({
      context: { goal: 'never' },
      ops: [
        op({ id: 'wait', description: 'Wait', invoke: () => {} }),
        op({ id: 'open', description: 'Open', choices: [], invoke: () => {} }),
        false,
        op({ id: 'rest', description: 'Rest', invoke: () => {} }),
      ],
    }));

    expect(Object.values(questions[0]?.criteria ?? {})).toEqual(['Wait', 'Rest']);
  });

  it('runs a pick however unsure the model is', async () => {
    const state = { isDone: false };
    decide = ({ state: seen }) =>
      seen.isDone === true ? { pick: 'Goal achieved: done' } : { pick: 'Finish', probability: 0.1 };

    const result = await task(async () => ({
      context: { goal: 'done', isDone: state.isDone },
      ops: [
        op({ id: 'finish', description: 'Finish', invoke: () => (state.isDone = true) }),
        op({ id: 'rest', description: 'Rest', invoke: () => {} }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['finish'] });
  });

  it('halts when an op throws', async () => {
    decide = () => ({ pick: 'Break' });

    const context = { goal: 'never', values: ['before'] };
    const result = await task(async () => ({
      context,
      ops: [
        op({
          id: 'break',
          description: 'Break',
          invoke: () => {
            context.values.push('after');
            throw new Error('boom');
          },
        }),
      ],
    }));

    expect(result).toEqual({
      status: 'halted',
      reason: 'error',
      error: 'boom',
      steps: [],
      context: { goal: 'never', values: ['before'] },
      usage: { inputTokens: 100, requests: 1 },
    });
  });

  it('halts a run that picks the same move on the same context a third time', async () => {
    decide = () => ({ pick: 'Wait' });

    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [op({ id: 'wait', description: 'Wait', invoke: () => {} })],
    }));

    expect(result).toMatchObject({ status: 'halted', reason: 'stalled', steps: ['wait', 'wait'] });
  });

  it('names a shared op by the group where it was picked and preserves a record choice value', async () => {
    const destination = { city: 'Tokyo' };
    const invoke = vi.fn();
    const shared = op({
      id: 'to',
      description: 'Choose destination',
      choices: { Tokyo: destination },
      invoke,
    });
    decide = () => ({ pick: 'Search form › Choose destination › Tokyo' });

    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        group({ id: 'searchForm', description: 'Search form' }, [shared]),
        group({ id: 'otherForm', description: 'Other form' }, [shared]),
      ],
    }));

    expect(result).toMatchObject({
      reason: 'stalled',
      steps: ['searchForm.to("Tokyo")', 'searchForm.to("Tokyo")'],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[0]).toBe(destination);
  });

  it.each([26, 27])('flattens up to 26 leaves into one question (%i leaves)', async count => {
    const items = Array.from({ length: count }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ state, criteria }) => ({
      pick:
        state.picked !== null
          ? 'Goal achieved: an item is picked'
          : (Object.values(criteria).find(
              description =>
                description.endsWith('item 0') || description.startsWith('Contains: item 0,'),
            ) ?? 'Pick an item'),
    });

    const result = await task(async () => ({
      context: { goal: 'an item is picked', picked: picked[0] ?? null },
      ops: [
        op({
          id: 'pick',
          description: 'Pick an item',
          choices: items,
          invoke: item => picked.push(item),
        }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 0")'] });
    expect(questions.map(question => Object.keys(question.criteria).length)).toEqual(
      count === 26 ? [26, 26] : [14, 2, 14],
    );
  });

  it('skips a single branch and leaves list parts out of the instruction trail', async () => {
    decide = ({ criteria }) => ({
      pick: Object.values(criteria).find(d => !d.startsWith('Goal achieved')) ?? '',
    });
    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        group({ id: 'form', description: 'Form' }, [
          op({
            id: 'pick',
            description: 'Pick an item',
            choices: Array.from({ length: 100 }, (_, i) => `item ${i}`),
            invoke: () => {},
          }),
        ]),
      ],
    }));

    expect(result).toMatchObject({
      reason: 'stalled',
      steps: ['form.pick("item 0")', 'form.pick("item 0")'],
    });
    // The single branches are passed through, so the goal rides with the first real question.
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(['achieved', 'next']);
    expect(questions.slice(0, 2).map(question => question.instructions)).toEqual([
      'Current action: Form › Pick an item. Which one?',
      'Current action: Form › Pick an item. Which one?',
    ]);
  });

  it('halts without asking the model when every branch is empty', async () => {
    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        false,
        null,
        undefined,
        group({ id: 'empty', description: 'Empty' }, [
          op({ id: 'pick', description: 'Pick', choices: {}, invoke: () => {} }),
        ]),
      ],
    }));

    expect(result).toEqual({
      status: 'halted',
      reason: 'noOptions',
      steps: [],
      context: { goal: 'never' },
      usage: { inputTokens: 0, requests: 0 },
    });
    expect(questions).toEqual([]);
  });

  it('keeps the last snapshot and successful steps when reading the next tick fails', async () => {
    const context = { goal: 'never', count: 0 };
    decide = () => ({ pick: 'Add' });
    const result = await task(async () => {
      if (context.count === 1) throw new Error('read failed');
      return {
        context,
        ops: [op({ id: 'add', description: 'Add', invoke: () => context.count++ })],
      };
    });

    expect(result).toEqual({
      status: 'halted',
      reason: 'error',
      error: 'read failed',
      steps: ['add'],
      context: { goal: 'never', count: 0 },
      usage: { inputTokens: 100, requests: 1 },
    });
  });

  it('returns a null context when the first tick fails', async () => {
    const result = await task(async () => {
      throw new Error('read failed');
    });
    expect(result).toEqual({
      status: 'halted',
      reason: 'error',
      error: 'read failed',
      steps: [],
      context: null,
      usage: { inputTokens: 0, requests: 0 },
    });
    expect(questions).toEqual([]);
  });

  it('halts once the run has spent its token budget, before asking again', async () => {
    const context = { goal: 'never', count: 0 };
    decide = () => ({ pick: 'Add' });
    const result = await task(
      async () => ({
        context,
        ops: [op({ id: 'add', description: 'Add', invoke: () => context.count++ })],
      }),
      { inputTokenBudget: 300 },
    );

    expect(result).toEqual({
      status: 'halted',
      reason: 'budget',
      steps: ['add', 'add', 'add'],
      context: { goal: 'never', count: 3 },
      usage: { inputTokens: 300, requests: 3 },
    });
    expect(requests).toHaveLength(3);
  });

  it('splits a level the server refuses as too large, every option still listing everything', async () => {
    // 2,600 long titles: 26 parts of 100, about 7 KB each, so no single request can hold all 26.
    const items = Array.from({ length: 2600 }, (_, i) => `item ${i} ${'x'.repeat(60)}`);
    const target = items[1234] ?? '';
    const picked: string[] = [];
    decide = ({ state, criteria }) => {
      if (state.picked !== null) return { pick: 'Goal achieved: the item is picked' };
      const descriptions = Object.values(criteria);
      return {
        pick:
          descriptions.find(d => d === target) ??
          descriptions.find(d => d.startsWith('Contains:') && d.split(', ').includes(target)) ??
          descriptions.find(d => d.startsWith('Contains:')) ??
          '',
      };
    };

    const result = await task(async () => ({
      context: { goal: 'the item is picked', picked: picked[0] ?? null },
      ops: [
        op({
          id: 'pick',
          description: 'Pick an item',
          choices: items,
          invoke: item => picked.push(item),
        }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved' });
    expect(picked).toEqual([target]);
    expect(refusals.length).toBeGreaterThan(0);
    // Refused requests cost nothing: only answered ones count.
    expect(result.usage).toEqual({ inputTokens: requests.length * 100, requests: requests.length });
    // Every part lists all its items in every request: 100 on the first level, then 4 inside one.
    const parts = questions
      .flatMap(q => Object.values(q.criteria))
      .filter(d => d.startsWith('Contains:'));
    expect(parts.length).toBeGreaterThan(26);
    expect(parts.every(d => [100, 4].includes(d.split(', ').length))).toBe(true);
  });

  it("splits a level when the model's context is too small for it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'decision prompt exceeds the model context (input is never truncated)',
        }),
        { status: 400 },
      ),
    );
    decide = ({ state }) => (state.isDone ? { pick: 'Goal achieved: done' } : { pick: 'Finish' });
    const state = { isDone: false };

    const result = await task(async () => ({
      context: { goal: 'done', isDone: state.isDone },
      ops: [
        op({ id: 'finish', description: 'Finish', invoke: () => (state.isDone = true) }),
        op({ id: 'rest', description: 'Rest', invoke: () => {} }),
        op({ id: 'wait', description: 'Wait', invoke: () => {} }),
      ],
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['finish'] });
    // Refused; the goal with the first half (Finish, Rest); the second half (Wait) needs no request;
    // the two winners; then the next tick, where the goal is met.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([
      ['achieved', 'next'],
      ['next'],
      ['achieved', 'next'],
    ]);
  });

  it('fails a refused pair instead of splitting it forever', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'request body must not exceed 64 KiB' }), {
        status: 413,
      }),
    );
    const invoke = vi.fn();

    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        op({ id: 'wait', description: 'Wait', invoke }),
        op({ id: 'rest', description: 'Rest', invoke }),
      ],
    }));

    expect(result).toMatchObject({ status: 'halted', reason: 'error' });
    expect(requests).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a goal answer that is neither option',
      { achieved: { choice: 'maybe', probabilities: { maybe: 1 } } },
      100,
      'the decision model answered the goal with "maybe"',
    ],
    ['no goal answer', {}, 100, 'the decision model answered the goal with "undefined"'],
    [
      'a move it never offered',
      {
        achieved: { choice: 'notYet', probabilities: { achieved: 0, notYet: 1 } },
        next: { choice: 'x1', probabilities: { x1: 1 } },
      },
      100,
      'the decision model chose "x1"',
    ],
    [
      'a negative token count',
      { achieved: { choice: 'notYet', probabilities: { achieved: 0, notYet: 1 } } },
      -400,
      'input_tokens',
    ],
  ])('halts on %s, running nothing', async (_, answers, inputTokens, error) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ answers, usage: { input_tokens: inputTokens } })),
    );
    const invoke = vi.fn();

    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        op({ id: 'wait', description: 'Wait', invoke }),
        op({ id: 'rest', description: 'Rest', invoke }),
      ],
    }));

    expect(result).toMatchObject({ status: 'halted', reason: 'error' });
    expect(result.status === 'halted' && result.reason === 'error' && result.error).toContain(
      error,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('halts when the budget runs out partway through a tick, keeping what it spent', async () => {
    // 100 items: the goal with a bundle, then an item: two requests a tick. The budget runs out
    // after the first.
    const items = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const invoke = vi.fn();
    decide = ({ criteria }) => ({
      pick: Object.values(criteria).find(d => !d.startsWith('Goal achieved')) ?? '',
    });

    const result = await task(
      async () => ({
        context: { goal: 'never' },
        ops: [op({ id: 'pick', description: 'Pick an item', choices: items, invoke })],
      }),
      { inputTokenBudget: 100 },
    );

    expect(result).toMatchObject({
      status: 'halted',
      reason: 'budget',
      usage: { inputTokens: 100, requests: 1 },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the configured API key as a bearer token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gut-'));
    await writeFile(
      join(dir, 'gut.config.json'),
      JSON.stringify({
        decisionModel: {
          endpoint: 'http://decision-model.invalid/v1/systemone',
          name: 'fake',
          apiKey: 'secret',
        },
      }),
    );
    vi.mocked(process.cwd).mockReturnValueOnce(dir);
    decide = () => ({ pick: 'Goal achieved: done' });

    await task(async () => ({
      context: { goal: 'done' },
      ops: [op({ id: 'wait', description: 'Wait', invoke: () => {} })],
    }));

    expect(new Headers(vi.mocked(fetch).mock.lastCall?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret',
    );
    await rm(dir, { recursive: true, force: true });
  });

  it('halts when the decision model returns an invalid option', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answers: {
            achieved: { choice: 'notYet', probabilities: { achieved: 0, notYet: 1 } },
            next: { choice: 'o99', probabilities: { o99: 1 } },
          },
          usage: { input_tokens: 100 },
        }),
      ),
    );
    const invoke = vi.fn();
    const result = await task(async () => ({
      context: { goal: 'never' },
      ops: [
        op({ id: 'wait', description: 'Wait', invoke }),
        op({ id: 'rest', description: 'Rest', invoke }),
      ],
    }));

    expect(result).toMatchObject({
      status: 'halted',
      reason: 'error',
      error: 'the decision model chose "o99"',
      steps: [],
      // The request that failed the pick was still billed.
      usage: { inputTokens: 100, requests: 1 },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
