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
  it('sums only turns the model answered', () => {
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
