import { describe, expect, it } from 'vitest';
import {
  type InspectorState,
  initialState,
  type Round,
  type Run,
} from '../state/inspector-state.ts';
import { endingsFor } from './endings.ts';

const round = (number: number, overrides: Partial<Round> = {}): Round => ({
  round: number,
  context: { goal: 'The counter is 3', count: 1 },
  ops: [],
  picks: [],
  turns: [],
  ...overrides,
});

const pickedRound = (number: number, step: string, count = 1): Round =>
  round(number, {
    context: { goal: 'The counter is 3', count },
    picked: { step, address: null, probabilities: [0.5], tokens: 10, ms: 5 },
  });

const baseRun = (overrides: Partial<Run> = {}): Run => ({
  runId: 'r1',
  name: 'Count to 3',
  model: null,
  inputTokenBudget: 50_000,
  isGoalCheckedInCode: false,
  rounds: [],
  ...overrides,
});

const stateOf = (overrides: Partial<InspectorState> = {}): InspectorState => ({
  ...initialState,
  task: 'counter.gut.ts',
  ...overrides,
});

const usage = { inputTokens: 24_783, requests: 8 };

describe('endingsFor', () => {
  it('shows nothing while a run goes on', () => {
    const run = baseRun({ rounds: [pickedRound(1, 'count')] });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([]);
  });

  it('shows Achieved with the rounds it took and the usage', () => {
    const run = baseRun({
      rounds: [pickedRound(1, 'count'), pickedRound(2, 'count'), round(3)],
      result: { status: 'achieved', steps: ['count', 'count'], context: null, usage },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'achieved', rounds: 3, usage },
    ]);
  });

  it('names the rounds whose context and pick repeated, for a stall', () => {
    const run = baseRun({
      rounds: [
        pickedRound(1, 'openLink', 1),
        pickedRound(2, 'openLink', 2),
        pickedRound(3, 'openLink', 1),
        pickedRound(4, 'back', 1),
        pickedRound(5, 'openLink', 1),
      ],
      result: {
        status: 'halted',
        reason: 'stalled',
        steps: ['openLink'],
        context: { goal: 'The counter is 3', count: 1 },
        usage,
      },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'stalled', step: 'openLink', rounds: [1, 3, 5] },
    ]);
  });

  it('leaves the evidence out of a stall with no picked round', () => {
    const run = baseRun({
      rounds: [round(1)],
      result: { status: 'halted', reason: 'stalled', steps: [], context: null, usage },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'stalled', rounds: [] },
    ]);
  });

  it('shows the budget with the spend and the budget the run had', () => {
    const run = baseRun({
      rounds: [round(1)],
      result: { status: 'halted', reason: 'budget', steps: [], context: null, usage },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'budget', usage, inputTokenBudget: 50_000 },
    ]);
  });

  it('shows the error the run halted on', () => {
    const run = baseRun({
      rounds: [round(1)],
      result: {
        status: 'halted',
        reason: 'error',
        error: 'the model answered with no options',
        steps: [],
        context: null,
        usage,
      },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'error', error: 'the model answered with no options' },
    ]);
  });

  it('shows nothing left to pick on the last round', () => {
    const run = baseRun({
      rounds: [pickedRound(1, 'count'), round(2)],
      result: { status: 'halted', reason: 'noOptions', steps: ['count'], context: null, usage },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'open')).toEqual([
      { kind: 'nothingToPick', round: 2 },
    ]);
  });

  it('shows a lost connection first, above the run outcome', () => {
    const run = baseRun({
      rounds: [round(1)],
      result: { status: 'halted', reason: 'budget', steps: [], context: null, usage },
    });
    expect(endingsFor(stateOf({ runs: [run] }), run, 'lost').map(ending => ending.kind)).toEqual([
      'reconnecting',
      'budget',
    ]);
  });

  it('shows the error the task threw, and that the task ended', () => {
    const state = stateOf({ ended: { error: 'boom' } });
    expect(endingsFor(state, undefined, 'open')).toEqual([
      { kind: 'threw', error: 'boom' },
      { kind: 'noRun' },
    ]);
  });

  it('shows that the task ended after a run, without an error', () => {
    const run = baseRun({ rounds: [round(1)] });
    expect(endingsFor(stateOf({ runs: [run], ended: {} }), run, 'open')).toEqual([
      { kind: 'ended' },
    ]);
  });

  it('shows no run attached when the task ended without one', () => {
    expect(endingsFor(stateOf({ ended: {} }), undefined, 'open')).toEqual([
      { kind: 'noRun' },
      { kind: 'ended' },
    ]);
  });

  it('shows nothing before the task has run anything', () => {
    expect(endingsFor(stateOf(), undefined, 'connecting')).toEqual([]);
  });
});
