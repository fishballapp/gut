import { describe, expect, it } from 'vitest';
import { type InspectorState, initialState, type Round } from '../state/inspector-state.ts';
import { resolveSelection } from './selection.ts';

const round = (n: number, turns: number[]): Round => ({
  round: n,
  context: { goal: 'g' },
  ops: [],
  picks: [{ maxOptions: 26 }],
  turns: turns.map(turn => ({
    turn,
    pick: 1,
    request: { state: { goal: 'g' }, questions: {} },
    optionInfo: {},
    retries: [],
    outcome: { status: 'asked' },
  })),
});

const run = (runId: string, rounds: Round[]) => ({
  runId,
  name: runId,
  model: null,
  inputTokenBudget: 1000,
  isGoalCheckedInCode: false,
  rounds,
});

const state: InspectorState = {
  ...initialState,
  runs: [run('a', [round(1, [1])]), run('b', [round(1, [1, 2]), round(2, [1, 2, 3])])],
};

describe('resolveSelection', () => {
  it('follows the newest run, round and turn when nothing is chosen', () => {
    const { run, round, turn } = resolveSelection(state, {});
    expect([run?.runId, round?.round, turn?.turn]).toEqual(['b', 2, 3]);
  });

  it("keeps a chosen round, and follows that round's newest turn", () => {
    const { round, turn } = resolveSelection(state, { runId: 'b', round: 1 });
    expect([round?.round, turn?.turn]).toEqual([1, 2]);
  });

  it('falls back to the newest when a choice no longer exists', () => {
    const { run, round } = resolveSelection(state, { runId: 'gone', round: 9 });
    expect([run?.runId, round?.round]).toEqual(['b', 2]);
  });

  it('selects nothing before the first run', () => {
    expect(resolveSelection(initialState, {})).toEqual({
      run: undefined,
      round: undefined,
      turn: undefined,
    });
  });
});
