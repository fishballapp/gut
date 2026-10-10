import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { group, initGut, ListStrategy, op, type RunTask } from './index.ts';

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

/** What a bundle's option lists: the lines under "Contains:", or nothing for any other option. */
const bundled = (description: string): string[] =>
  description.startsWith('Contains:\n')
    ? description
        .split('\n')
        .slice(1)
        .map(line => line.trim())
    : [];

// Like Ollama, a choice takes at most 26 options.
const fakeConfig = {
  decisionModel: {
    endpoint: 'http://decision-model.invalid/v1/systemone',
    name: 'fake',
    capabilities: { choiceQuestions: { maxOptions: 26 } },
  },
};
const { runTask } = await initGut({ config: fakeConfig });

beforeAll(async () => {
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

    const result = await runTask('test', async () => ({
      context: { goal: 'the counter is 1', value: counter.value },
      ops: {
        add: op('Add one to the counter', () => counter.value++),
      },
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['add'] });
    expect(counter.value).toBe(1);
    // One op leaves nothing to choose, so each round asks the goal alone before its step runs.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([['achieved'], ['achieved']]);
  });

  it('stops only on isGoalAchieved when it is set, never asking the model about the goal', async () => {
    const counter = { value: 0 };
    // A model that would claim the goal at once, if it were asked.
    decide = ({ criteria }) => ({
      pick: Object.values(criteria).find(d => d.startsWith('Goal achieved')) ?? 'Add one',
    });

    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'the counter is 2', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
          reset: op('Reset', () => (counter.value = 0)),
        },
      }),
      { isGoalAchieved: () => counter.value === 2 },
    );

    expect(result).toMatchObject({
      status: 'achieved',
      steps: ['add', 'add'],
      context: { goal: 'the counter is 2', value: 2 },
      usage: { requests: 2 },
    });
    // Rounds 1 and 2 ask only the move; round 3 is checked in code and asks nothing.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([['next'], ['next']]);
  });

  it('runs a lone op with no request at all while an async isGoalAchieved checks the goal', async () => {
    const counter = { value: 0 };

    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'the counter is 2', value: counter.value },
        ops: {
          add: op('Add one', () => counter.value++),
        },
      }),
      { isGoalAchieved: async () => counter.value === 2 },
    );

    expect(result).toEqual({
      status: 'achieved',
      steps: ['add', 'add'],
      context: { goal: 'the counter is 2', value: 2 },
      usage: { inputTokens: 0, requests: 0 },
    });
    expect(requests).toEqual([]);
  });

  it('leaves the goal out of every request of a list asked in bundles', async () => {
    const items = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const picked: string[] = [];
    decide = ({ criteria }) => {
      const descriptions = Object.values(criteria);
      return {
        pick:
          descriptions.find(d => d === 'item 42') ??
          descriptions.find(d => bundled(d).includes('item 42')) ??
          '',
      };
    };

    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'item 42 is picked', picked: picked[0] ?? null },
        ops: {
          pick: op('Pick an item', {
            choices: items,
            invoke: item => picked.push(item),
          }),
        },
      }),
      { isGoalAchieved: () => picked.includes('item 42') },
    );

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 42")'] });
    // A bundle, then the item inside it; neither request carries the goal.
    expect(requests.map(r => Object.keys(r.questions))).toEqual([['next'], ['next']]);
  });

  it('halts when isGoalAchieved throws', async () => {
    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: {
          wait: op('Wait', () => {}),
        },
      }),
      {
        isGoalAchieved: () => {
          throw new Error('the page is gone');
        },
      },
    );

    expect(result).toMatchObject({ status: 'halted', reason: 'error', error: 'the page is gone' });
    expect(requests).toEqual([]);
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
          descriptions.find(
            d =>
              d.startsWith('Contains:') &&
              d
                .split('\n')
                .map(l => l.trim())
                .includes('item 42'),
          ) ??
          descriptions.find(d => d.startsWith('Contains:\n  item 40\n')) ??
          'Pick an item',
      };
    };

    const result = await runTask('test', async () => ({
      context: { goal: 'item 42 is picked', picked: picked[0] ?? null },
      ops: {
        pick: op('Pick an item', {
          choices: items,
          invoke: item => picked.push(item),
        }),
      },
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 42")'] });
    expect(picked).toEqual(['item 42']);
    // Round 1: the goal rides with the first question, a part of the list (the one op isn't
    // asked), then the item. Round 2: the goal with the first question again, now met.
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

    const result = await runTask('test', async () => ({
      context: { goal: 'item 42 is picked', picked: picked[0] ?? null },
      ops: {
        pick: op('Pick an item', {
          choices: items,
          strategy: ListStrategy.knockout,
          invoke: item => picked.push(item),
        }),
      },
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['pick("item 42")'] });
    // Pages of 26 real items, then the four page winners; no bundles. Round 2 meets the goal with
    // its first page.
    expect(questions.map(q => Object.keys(q.criteria).length)).toEqual([26, 26, 26, 22, 4, 26]);
    expect(
      questions.flatMap(q => Object.values(q.criteria)).some(d => d.startsWith('Contains:')),
    ).toBe(false);
  });

  it('hides an op whose choices are empty, and a falsy entry', async () => {
    decide = () => ({ pick: 'Wait' });

    await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wait: op('Wait', () => {}),
        open: op('Open', { choices: [], invoke: () => {} }),
        hidden: false,
        rest: op('Rest', () => {}),
      },
    }));

    expect(Object.values(questions[0]?.criteria ?? {})).toEqual(['Wait', 'Rest']);
  });

  it('names a nested step by its key path and skips falsy entries', async () => {
    const invoke = vi.fn();
    decide = () => ({ pick: 'Outer › Inner › Deep' });

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        skippedFalse: false,
        skippedNull: null,
        skippedUndefined: undefined,
        outer: group('Outer', {
          innerSkipped: false,
          inner: group('Inner', {
            deep: op('Deep', invoke),
          }),
        }),
      },
    }));

    expect(result).toMatchObject({
      reason: 'stalled',
      steps: ['outer.inner.deep', 'outer.inner.deep'],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('preserves key order when showing options to the model', async () => {
    decide = () => ({ pick: 'First' });

    await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        first: op('First', () => {}),
        second: op('Second', () => {}),
        third: op('Third', () => {}),
      },
    }));

    expect(Object.values(questions[0]?.criteria ?? {})).toEqual(['First', 'Second', 'Third']);
  });

  it('runs a pick however unsure the model is', async () => {
    const state = { isDone: false };
    decide = ({ state: seen }) =>
      seen.isDone === true ? { pick: 'Goal achieved: done' } : { pick: 'Finish', probability: 0.1 };

    const result = await runTask('test', async () => ({
      context: { goal: 'done', isDone: state.isDone },
      ops: {
        finish: op('Finish', () => (state.isDone = true)),
        rest: op('Rest', () => {}),
      },
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['finish'] });
  });

  it('halts when an op throws', async () => {
    decide = () => ({ pick: 'Break' });

    const context = { goal: 'never', values: ['before'] };
    const result = await runTask('test', async () => ({
      context,
      ops: {
        break: op('Break', () => {
          context.values.push('after');
          throw new Error('boom');
        }),
      },
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

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wait: op('Wait', () => {}),
      },
    }));

    expect(result).toMatchObject({ status: 'halted', reason: 'stalled', steps: ['wait', 'wait'] });
  });

  it('names a shared op by the group where it was picked and preserves a record choice value', async () => {
    const destination = { city: 'Tokyo' };
    const invoke = vi.fn();
    const shared = op('Choose destination', {
      choices: { Tokyo: destination },
      invoke,
    });
    decide = () => ({ pick: 'Search form › Choose destination › Tokyo' });

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        searchForm: group('Search form', { to: shared }),
        otherForm: group('Other form', { to: shared }),
      },
    }));

    expect(result).toMatchObject({
      reason: 'stalled',
      steps: ['searchForm.to("Tokyo")', 'searchForm.to("Tokyo")'],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[0]).toBe(destination);
  });

  /** `count` ops named `${prefix} ${i}`, keyed `${prefix}${i}`. */
  const items = (prefix: string, count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${prefix}${i}`, op(`${prefix} ${i}`, () => {})]),
    );

  /** Runs `run` with a `runTask` whose decision model takes at most `maxOptions` options. */
  const withMaxOptions = async (maxOptions: number, run: (runTask: RunTask) => Promise<void>) => {
    const decisionModel = {
      ...fakeConfig.decisionModel,
      capabilities: { choiceQuestions: { maxOptions } },
    };
    await run((await initGut({ config: { decisionModel } })).runTask);
  };

  it('goes back out of a wrong group, which is then gone, and enters the one left without asking', async () => {
    decide = ({ criteria }) => {
      const options = Object.values(criteria);
      if (options.includes('None of these: go back')) return { pick: 'None of these: go back' };
      const right = options.find(option => option.startsWith('Right box'));
      if (right !== undefined) return { pick: right };
      return { pick: options.find(option => option.endsWith('wrong 3')) ?? '' };
    };

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wrong: group('Wrong box', items('wrong', 14)),
        right: group('Right box', items('right', 14)),
      },
    }));

    expect(result.steps[0]).toBe('wrong.wrong3');
    // The first round's questions; the next rounds repeat it until the run stalls.
    expect(questions.slice(0, 3).map(question => Object.values(question.criteria))).toEqual([
      [
        ...Array.from({ length: 14 }, (_, i) => `Wrong box › wrong ${i}`),
        [
          'Right box — contains:',
          ...Array.from({ length: 8 }, (_, i) => `  right ${i}`),
          '  … (+6 more)',
        ].join('\n'),
      ],
      [...Array.from({ length: 14 }, (_, i) => `right ${i}`), 'None of these: go back'],
      Array.from({ length: 14 }, (_, i) => `Wrong box › wrong ${i}`),
    ]);
  });

  it('opens a group adding fewest options when maxOptions is small, keeping the larger group closed', async () => {
    await withMaxOptions(5, async runTask => {
      decide = () => ({ pick: 'a › a 0' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          a: group('a', items('a', 2)),
          b: group('b', items('b', 4)),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})).toEqual([
        'a › a 0',
        'a › a 1',
        'b — contains:\n  b 0\n  b 1\n  b 2\n  b 3',
      ]);
    });
  });

  it('opens a group adding fewest options (smallest first) even when listed after a larger group', async () => {
    await withMaxOptions(5, async runTask => {
      decide = () => ({ pick: 'b › b 0' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          a: group('a', items('a', 4)),
          b: group('b', items('b', 2)),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})).toEqual([
        'a — contains:\n  a 0\n  a 1\n  a 2\n  a 3',
        'b › b 0',
        'b › b 1',
      ]);
    });
  });

  it('opens a closed node at depth while a big group stays closed', async () => {
    await withMaxOptions(5, async runTask => {
      decide = () => ({ pick: 'Container › Small › small 0' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          big: group('Big', items('big', 10)),
          container: group('Container', {
            small: group('Small', items('small', 2)),
          }),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})).toEqual([
        [
          'Big — contains:',
          ...Array.from({ length: 8 }, (_, i) => `  big ${i}`),
          '  … (+2 more)',
        ].join('\n'),
        'Container › Small › small 0',
        'Container › Small › small 1',
      ]);
    });
  });

  it('opens the smaller group first when two closed groups do not both fit', async () => {
    decide = () => ({ pick: 'Small › small 0' });
    await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        big: group('Big', items('big', 20)),
        small: group('Small', items('small', 10)),
      },
    }));
    expect(Object.values(questions[0]?.criteria ?? {})).toEqual([
      [
        'Big — contains:',
        ...Array.from({ length: 8 }, (_, i) => `  big ${i}`),
        '  … (+12 more)',
      ].join('\n'),
      ...Array.from({ length: 10 }, (_, i) => `Small › small ${i}`),
    ]);
  });

  it('removes a closed group inside an opened parent when going back, and does not offer it next', async () => {
    await withMaxOptions(4, async runTask => {
      decide = ({ criteria }) => {
        const options = Object.values(criteria);
        if (options.includes('None of these: go back')) return { pick: 'None of these: go back' };
        const nested = options.find(option => option.includes('Nested'));
        if (nested !== undefined) return { pick: nested };
        return { pick: options.find(option => option.endsWith('first')) ?? '' };
      };
      const result = await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          outer: group('Outer', {
            first: op('first', () => {}),
            second: op('second', () => {}),
            nested: group('Nested', items('nested', 3)),
          }),
        },
      }));
      expect(result.steps[0]).toBe('outer.first');
      expect(questions.slice(0, 3).map(question => Object.values(question.criteria))).toEqual([
        [
          'Outer › first',
          'Outer › second',
          'Outer › Nested — contains:\n  nested 0\n  nested 1\n  nested 2',
        ],
        ['nested 0', 'nested 1', 'nested 2', 'None of these: go back'],
        ['Outer › first', 'Outer › second'],
      ]);
    });
  });

  it('previews a closed group as an indented outline, omitting inner groups with no shown moves', async () => {
    await withMaxOptions(2, async runTask => {
      decide = () => ({ pick: 'Other' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          other: op('Other', () => {}),
          main: group('Main content', {
            offices: group('Offices', {
              leeds: group('Leeds', {
                details: op('Open link "Details"', () => {}),
                directions: op('Open link "Directions"', () => {}),
              }),
              manchester: group('Manchester', {
                details: op('Open link "Details"', () => {}),
              }),
            }),
            extra: group('Extra', items('extra', 5)),
            omitted: group('Omitted', items('omitted', 4)),
          }),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})[1]).toBe(
        [
          'Main content — contains:',
          '  Offices',
          '    Leeds',
          '      Open link "Details"',
          '      Open link "Directions"',
          '    Manchester',
          '      Open link "Details"',
          '  Extra',
          '    extra 0',
          '    extra 1',
          '    extra 2',
          '    extra 3',
          '    extra 4',
          '  … (+4 more)',
        ].join('\n'),
      );
    });
  });

  it('shows an op with choices as a level in the group outline', async () => {
    await withMaxOptions(2, async runTask => {
      decide = () => ({ pick: 'Other' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          other: op('Other', () => {}),
          form: group('Form', {
            country: op('Select country', {
              choices: ['France', 'Germany', 'Spain'],
              invoke: () => {},
            }),
            submit: op('Submit', () => {}),
          }),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})[1]).toBe(
        [
          'Form — contains:',
          '  Select country',
          '    France',
          '    Germany',
          '    Spain',
          '  Submit',
        ].join('\n'),
      );
    });
  });

  it('omits the more line when a group has 8 or fewer moves, and adds it when overflowing', async () => {
    await withMaxOptions(2, async runTask => {
      decide = () => ({ pick: 'Other' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          other: op('Other', () => {}),
          exact8: group('Exact 8', items('item', 8)),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})[1]).toBe(
        ['Exact 8 — contains:', ...Array.from({ length: 8 }, (_, i) => `  item ${i}`)].join('\n'),
      );
    });

    questions.length = 0;
    await withMaxOptions(2, async runTask => {
      decide = () => ({ pick: 'Other' });
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          other: op('Other', () => {}),
          overflow: group('Overflow', items('item', 9)),
        },
      }));
      expect(Object.values(questions[0]?.criteria ?? {})[1]).toBe(
        [
          'Overflow — contains:',
          ...Array.from({ length: 8 }, (_, i) => `  item ${i}`),
          '  … (+1 more)',
        ].join('\n'),
      );
    });
  });

  it('bundles closed groups when even with everything closed they exceed maxOptions', async () => {
    await withMaxOptions(2, async runTask => {
      decide = ({ criteria }) => {
        const options = Object.values(criteria);
        return { pick: options[0] ?? '' };
      };
      await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          g1: group('G1', items('g1', 2)),
          g2: group('G2', items('g2', 2)),
          g3: group('G3', items('g3', 2)),
        },
      }));
      // Each group keeps its outline inside the bundle, one block under the other.
      expect(Object.values(questions[0]?.criteria ?? {})[0]).toBe(
        [
          'Contains:',
          '  G1 — contains:',
          '    g1 0',
          '    g1 1',
          '  G2 — contains:',
          '    g2 0',
          '    g2 1',
        ].join('\n'),
      );
    });
  });

  it('offers going back beside the bundles of a group too long for one question, never inside one', async () => {
    decide = ({ criteria }) => {
      const options = Object.values(criteria);
      const wrong = options.find(option => option.startsWith('Wrong box'));
      if (wrong !== undefined) return { pick: wrong };
      const goBack = options.find(option => option.includes('go back'));
      if (goBack !== undefined) return { pick: goBack };
      return { pick: options.find(option => option.startsWith('Right box')) ?? '' };
    };

    await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wrong: group('Wrong box', items('wrong', 30)),
        right: group('Right box', items('right', 3)),
      },
    }));

    const [, inside] = questions.map(question => Object.values(question.criteria));
    expect(inside?.at(-1)).toBe('None of these: go back');
    expect(inside?.filter(option => option.includes('go back'))).toHaveLength(1);
    expect(inside?.length).toBeLessThanOrEqual(26);
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
                description.endsWith('item 0') || description.startsWith('Contains:\n  item 0\n'),
            ) ?? 'Pick an item'),
    });

    const result = await runTask('test', async () => ({
      context: { goal: 'an item is picked', picked: picked[0] ?? null },
      ops: {
        pick: op('Pick an item', {
          choices: items,
          invoke: item => picked.push(item),
        }),
      },
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
    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        form: group('Form', {
          pick: op('Pick an item', {
            choices: Array.from({ length: 100 }, (_, i) => `item ${i}`),
            invoke: () => {},
          }),
        }),
      },
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

  it('asks the goal alone, then halts, when every branch is empty', async () => {
    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        falsyFalse: false,
        falsyNull: null,
        falsyUndefined: undefined,
        empty: group('Empty', {
          pick: op('Pick', { choices: {}, invoke: () => {} }),
        }),
      },
    }));

    expect(result).toEqual({
      status: 'halted',
      reason: 'noOptions',
      steps: [],
      context: { goal: 'never' },
      usage: { inputTokens: 100, requests: 1 },
    });
    expect(requests.map(request => Object.keys(request.questions))).toEqual([['achieved']]);
  });

  it('ends achieved on a round with no ops when the model finds the goal met', async () => {
    decide = () => ({ pick: 'Goal achieved: The page says "Thank you"' });

    const result = await runTask('test', async () => ({
      context: { goal: 'The page says "Thank you"' },
      ops: {},
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: [] });
    expect(requests.map(request => Object.keys(request.questions))).toEqual([['achieved']]);
  });

  it('halts without asking the model when there are no ops and isGoalAchieved is set', async () => {
    const result = await runTask('test', async () => ({ context: { goal: 'never' }, ops: {} }), {
      isGoalAchieved: () => false,
    });

    expect(result).toMatchObject({
      status: 'halted',
      reason: 'noOptions',
      usage: { inputTokens: 0, requests: 0 },
    });
    expect(requests).toEqual([]);
  });

  it('keeps the last snapshot and successful steps when reading the next round fails', async () => {
    const context = { goal: 'never', count: 0 };
    decide = () => ({ pick: 'Add' });
    const result = await runTask('test', async () => {
      if (context.count === 1) throw new Error('read failed');
      return {
        context,
        ops: {
          add: op('Add', () => context.count++),
        },
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

  it('returns a null context when the first round fails', async () => {
    const result = await runTask('test', async () => {
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
    const result = await runTask(
      'test',
      async () => ({
        context,
        ops: {
          add: op('Add', () => context.count++),
        },
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
          descriptions.find(d => bundled(d).includes(target)) ??
          descriptions.find(d => d.startsWith('Contains:')) ??
          '',
      };
    };

    const result = await runTask('test', async () => ({
      context: { goal: 'the item is picked', picked: picked[0] ?? null },
      ops: {
        pick: op('Pick an item', {
          choices: items,
          invoke: item => picked.push(item),
        }),
      },
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
    expect(parts.every(d => [100, 4].includes(bundled(d).length))).toBe(true);
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

    const result = await runTask('test', async () => ({
      context: { goal: 'done', isDone: state.isDone },
      ops: {
        finish: op('Finish', () => (state.isDone = true)),
        rest: op('Rest', () => {}),
        wait: op('Wait', () => {}),
      },
    }));

    expect(result).toMatchObject({ status: 'achieved', steps: ['finish'] });
    // Refused; the goal with the first half (Finish, Rest); the second half (Wait) needs no request;
    // the two winners; then the next round, where the goal is met.
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

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wait: op('Wait', invoke),
        rest: op('Rest', invoke),
      },
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

    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wait: op('Wait', invoke),
        rest: op('Rest', invoke),
      },
    }));

    expect(result).toMatchObject({ status: 'halted', reason: 'error' });
    expect(result.status === 'halted' && result.reason === 'error' && result.error).toContain(
      error,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('halts when the budget runs out partway through a round, keeping what it spent', async () => {
    // 100 items: the goal with a bundle, then an item: two requests a round. The budget runs out
    // after the first.
    const items = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const invoke = vi.fn();
    decide = ({ criteria }) => ({
      pick: Object.values(criteria).find(d => !d.startsWith('Goal achieved')) ?? '',
    });

    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'never' },
        ops: {
          pick: op('Pick an item', { choices: items, invoke }),
        },
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
    const { runTask: runWithApiKey } = await initGut({
      config: {
        decisionModel: {
          endpoint: 'http://decision-model.invalid/v1/systemone',
          name: 'fake',
          apiKey: 'secret',
        },
      },
    });
    decide = () => ({ pick: 'Goal achieved: done' });

    await runWithApiKey('test', async () => ({
      context: { goal: 'done' },
      ops: {
        wait: op('Wait', () => {}),
      },
    }));

    expect(new Headers(vi.mocked(fetch).mock.lastCall?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret',
    );
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
    const result = await runTask('test', async () => ({
      context: { goal: 'never' },
      ops: {
        wait: op('Wait', invoke),
        rest: op('Rest', invoke),
      },
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

  it('terminates with maxOptions 2 when entering a group while another root option exists', async () => {
    await withMaxOptions(2, async runTask => {
      const executed: string[] = [];
      decide = ({ criteria }) => {
        const descriptions = Object.values(criteria);
        const picked =
          descriptions.find(d => d.startsWith('Group')) ??
          descriptions.find(d => d.startsWith('Contains:\n  m1')) ??
          descriptions.find(d => d === 'm1');
        return { pick: picked ?? '' };
      };

      const result = await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          other: op('Other move', () => executed.push('other')),
          grp: group('Group', {
            m1: op('m1', () => executed.push('m1')),
            m2: op('m2', () => executed.push('m2')),
            m3: op('m3', () => executed.push('m3')),
          }),
        },
      }));

      expect(executed).toEqual(['m1', 'm1']);
      expect(result).toMatchObject({ status: 'halted', reason: 'stalled' });
    });
  });

  it('goes back out of a nested single-child group to an ancestor that still has trees', async () => {
    await withMaxOptions(2, async runTask => {
      const executed: string[] = [];
      decide = ({ criteria }) => {
        const descriptions = Object.values(criteria);
        if (descriptions.some(d => d.startsWith('A'))) {
          return { pick: descriptions.find(d => d.startsWith('A')) ?? '' };
        }
        if (descriptions.some(d => d.startsWith('B'))) {
          return { pick: descriptions.find(d => d.startsWith('B')) ?? '' };
        }
        if (descriptions.some(d => d.includes('go back'))) {
          return { pick: descriptions.find(d => d.includes('go back')) ?? '' };
        }
        if (descriptions.some(d => d.startsWith('C'))) {
          return { pick: descriptions.find(d => d.startsWith('C')) ?? '' };
        }
        return { pick: '' };
      };

      const result = await runTask('test', async () => ({
        context: { goal: 'never' },
        ops: {
          a: group('A', {
            b: group('B', {
              m1: op('m1', () => executed.push('m1')),
              m2: op('m2', () => executed.push('m2')),
              m3: op('m3', () => executed.push('m3')),
            }),
          }),
          c: op('C', () => executed.push('c')),
        },
      }));

      expect(executed).toEqual(['c', 'c']);
      expect(result).toMatchObject({ status: 'halted', reason: 'stalled', steps: ['c', 'c'] });
    });
  });
});
