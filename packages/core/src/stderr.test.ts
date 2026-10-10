import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { initGut, op } from './index.ts';

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

const fakeConfig = {
  decisionModel: {
    endpoint: 'http://decision-model.invalid/v1/systemone',
    name: 'fake',
    capabilities: { choiceQuestions: { maxOptions: 26 } },
  },
};

describe('stderr line pinning', () => {
  const stderrLines: string[] = [];
  let originalWrite: typeof process.stderr.write;

  beforeAll(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
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
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'performance'] });
    stderrLines.length = 0;
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrLines.push(
        typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array),
      );
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    vi.useRealTimers();
  });

  it('pins stderr output byte-for-byte on normal achieved run with multiple ops', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    const counter = { value: 0 };
    decide = ({ state, instructions }) => {
      vi.advanceTimersByTime(instructions.includes('goal') ? 200 : 1000);
      return {
        pick: state.value === 1 ? 'Goal achieved: the counter is 1' : 'Add one to the counter',
        probability: 0.9,
      };
    };

    await runTask('test', async () => {
      vi.advanceTimersByTime(300);
      return {
        context: { goal: 'the counter is 1', value: counter.value },
        ops: {
          add: op('Add one to the counter', () => {
            vi.advanceTimersByTime(500);
            counter.value++;
          }),
          noop: op('Do nothing', () => {}),
        },
      };
    });

    expect(stderrLines).toEqual([
      'round 1  add  0.90  1.5s  100 input tokens\n',
      'round 2  achieved  0.90  1.5s  100 input tokens\n',
      'achieved  200 input tokens in 2 requests\n',
    ]);
  });

  it('pins stderr output byte-for-byte on isGoalAchieved check with multiple ops', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    const counter = { value: 0 };
    decide = () => {
      vi.advanceTimersByTime(1000);
      return { pick: 'Add one', probability: 0.85 };
    };

    await runTask(
      'test',
      async () => {
        vi.advanceTimersByTime(200);
        return {
          context: { goal: 'the counter is 1', value: counter.value },
          ops: {
            add: op('Add one', () => counter.value++),
            noop: op('Do nothing', () => {}),
          },
        };
      },
      {
        isGoalAchieved: () => {
          vi.advanceTimersByTime(100);
          return counter.value === 1;
        },
      },
    );

    expect(stderrLines).toEqual([
      'round 1  add  0.85  1.3s  100 input tokens\n',
      'round 2  achieved  checked  0.3s\n',
      'achieved  100 input tokens in 1 requests\n',
    ]);
  });

  it('pins stderr output byte-for-byte on error outcome with multiple ops', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    decide = ({ instructions }) => {
      vi.advanceTimersByTime(instructions.includes('goal') ? 100 : 300);
      return { pick: 'Break', probability: 0.7 };
    };

    await runTask('test', async () => {
      vi.advanceTimersByTime(100);
      return {
        context: { goal: 'never' },
        ops: {
          break: op('Break', () => {
            vi.advanceTimersByTime(50);
            throw new Error('boom');
          }),
          other: op('Other', () => {}),
        },
      };
    });

    expect(stderrLines).toEqual([
      'round 1  break  0.70  0.5s  100 input tokens\n',
      'halted: error (boom)  100 input tokens in 1 requests\n',
    ]);
  });

  it('pins stderr output byte-for-byte on stalled outcome with multiple ops', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    decide = ({ instructions }) => {
      vi.advanceTimersByTime(instructions.includes('goal') ? 50 : 150);
      return { pick: 'Wait', probability: 0.9 };
    };

    await runTask('test', async () => {
      vi.advanceTimersByTime(100);
      return {
        context: { goal: 'never' },
        ops: {
          wait: op('Wait', () => {}),
          other: op('Other', () => {}),
        },
      };
    });

    expect(stderrLines).toEqual([
      'round 1  wait  0.90  0.3s  100 input tokens\n',
      'round 2  wait  0.90  0.3s  100 input tokens\n',
      'round 3  wait  0.90  0.3s  100 input tokens\n',
      'halted: stalled  300 input tokens in 3 requests\n',
    ]);
  });

  it('pins stderr output byte-for-byte on noOptions outcome', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    decide = () => {
      vi.advanceTimersByTime(400);
      return { pick: 'notYet', probability: 0.95 };
    };

    await runTask('test', async () => {
      vi.advanceTimersByTime(100);
      return {
        context: { goal: 'never' },
        ops: {},
      };
    });

    expect(stderrLines).toEqual(['halted: noOptions  100 input tokens in 1 requests\n']);
  });

  it('pins stderr output byte-for-byte on budget outcome with multiple ops', async () => {
    const { runTask } = await initGut({ config: fakeConfig });
    decide = ({ instructions }) => {
      vi.advanceTimersByTime(instructions.includes('goal') ? 50 : 150);
      return { pick: 'Add', probability: 0.9 };
    };

    await runTask(
      'test',
      async () => {
        vi.advanceTimersByTime(100);
        return {
          context: { goal: 'never' },
          ops: {
            add: op('Add', () => {}),
            other: op('Other', () => {}),
          },
        };
      },
      { inputTokenBudget: 100 },
    );

    expect(stderrLines).toEqual([
      'round 1  add  0.90  0.3s  100 input tokens\n',
      'halted: budget  100 input tokens in 1 requests\n',
    ]);
  });
});
