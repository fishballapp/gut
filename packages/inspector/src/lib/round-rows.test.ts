import { describe, expect, it } from 'vitest';
import type { Decision } from '../state/inspector-state.ts';
import { findAwaitingTurn, findWaitingStep } from './round-rows.ts';

describe('findWaitingStep', () => {
  it('finds the step waiting to run in its run and round', () => {
    const decision: Decision = {
      id: 'd2',
      runId: 'run',
      round: 2,
      on: { kind: 'step', step: 'add' },
    };
    expect(findWaitingStep([decision], 'run', 2)).toEqual(decision);
    expect(findWaitingStep([decision], 'other', 2)).toBeUndefined();
    expect(findWaitingStep([decision], 'run', 3)).toBeUndefined();
  });

  it('ignores a turn waiting in its round', () => {
    const decision: Decision = {
      id: 'd3',
      runId: 'run',
      round: 2,
      on: { kind: 'turn', turn: 1, isReview: false },
    };
    expect(findWaitingStep([decision], 'run', 2)).toBeUndefined();
  });
});

describe('findAwaitingTurn', () => {
  it('finds the decision a turn waits on', () => {
    const decision: Decision = {
      id: 'd1',
      runId: 'run',
      round: 2,
      on: { kind: 'turn', turn: 1, isReview: false },
    };
    expect(findAwaitingTurn([decision], 'run', 2, 1)).toEqual(decision);
    expect(findAwaitingTurn([decision], 'run', 2, 2)).toBeUndefined();
  });
});
