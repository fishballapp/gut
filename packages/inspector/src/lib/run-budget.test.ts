import { describe, expect, it } from 'vitest';
import type { Run, Turn } from '../state/inspector-state.ts';
import { formatBudgetLabel, runBudget } from './run-budget.ts';

const turn = (outcome: Turn['outcome']): Turn => ({
  turn: 1,
  request: { state: { goal: 'g' }, questions: {} },
  edits: [],
  optionInfo: {},
  retries: [],
  outcome,
});

const runOf = (turns: Turn[]): Run => ({
  runId: 'r1',
  name: 'n',
  model: null,
  inputTokenBudget: 50_000,
  isGoalCheckedInCode: false,
  rounds: [{ round: 1, context: { goal: 'g' }, ops: [], picks: [], turns }],
});

describe('runBudget', () => {
  it('sums the turns the model answered, not yours', () => {
    expect(
      runBudget(
        runOf([
          turn({
            status: 'answered',
            by: { kind: 'model', name: 'clef', endpoint: 'http://x' },
            answers: {},
            inputTokens: 1000,
            ms: 1,
          }),
          turn({
            status: 'answered',
            by: { kind: 'you' },
            answers: {},
            inputTokens: 0,
            ms: 1,
          }),
          turn({
            status: 'answered',
            by: { kind: 'model', name: 'clef', endpoint: 'http://x' },
            answers: {},
            inputTokens: 400,
            ms: 1,
          }),
          turn({ status: 'asked' }),
          turn({ status: 'dropped', reason: 'budget' }),
        ]),
      ),
    ).toEqual({ inputTokens: 1400, requests: 2, budget: 50_000 });
  });

  it("counts the model's answer waiting for you or replaced by you, and abandoned picks", () => {
    const suggestion = {
      by: { kind: 'model' as const, name: 'clef', endpoint: 'http://x' },
      answers: {},
      inputTokens: 300,
      ms: 1,
    };
    const replaced: Turn = {
      ...turn({ status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 300, ms: 1 }),
      suggestion,
    };
    const waiting: Turn = { ...turn({ status: 'asked' }), turn: 2, suggestion };
    const run = runOf([replaced, waiting]);
    const [round] = run.rounds;
    if (round === undefined) throw new Error('no round');
    const abandoned = { maxOptions: 26, edits: [], abandoned: { inputTokens: 50, requests: 1 } };
    const withAbandoned = { ...run, rounds: [{ ...round, picks: [abandoned] }] };
    expect(runBudget(withAbandoned)).toMatchObject({ inputTokens: 650, requests: 3 });
  });

  it('is zero before any model turn', () => {
    expect(runBudget(runOf([]))).toEqual({
      inputTokens: 0,
      requests: 0,
      budget: 50_000,
    });
  });
});

describe('formatBudgetLabel', () => {
  it('matches the sketch wording', () => {
    expect(formatBudgetLabel({ inputTokens: 17_400, requests: 6, budget: 50_000 })).toBe(
      '17.4k / 50k tokens · 6 requests',
    );
    expect(formatBudgetLabel({ inputTokens: 458, requests: 1, budget: 50_000 })).toBe(
      '458 / 50k tokens · 1 request',
    );
  });
});
