import { describe, expect, it } from 'vitest';
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import {
  findAwaitingTurn,
  findWaitingStep,
  isSameRow,
  stopRows,
  visibleRows,
} from './round-rows.ts';

const turn = (number: number): Turn => ({
  turn: number,
  request: { state: { goal: 'g' }, questions: {} },
  optionInfo: {},
  retries: [],
  outcome: { status: 'asked' },
});

const round = (number: number, turns: Turn[] = []): Round => ({
  round: number,
  context: { goal: 'g' },
  ops: [],
  picks: [],
  turns,
});

describe('visibleRows', () => {
  it('lists every round when none is selected', () => {
    expect(visibleRows([round(1), round(2)], undefined)).toEqual([{ round: 1 }, { round: 2 }]);
  });

  it('nests the selected round’s turns under it, in order', () => {
    const rounds = [round(1, [turn(1)]), round(2, [turn(1), turn(2)]), round(3)];
    expect(visibleRows(rounds, 2)).toEqual([
      { round: 1 },
      { round: 2 },
      { round: 2, turn: 1 },
      { round: 2, turn: 2 },
      { round: 3 },
    ]);
  });

  it('lists nothing for a run with no rounds', () => {
    expect(visibleRows([], 1)).toEqual([]);
  });
});

describe('isSameRow', () => {
  it('matches a round row only with a round row of the same round', () => {
    expect(isSameRow({ round: 2 }, { round: 2 })).toBe(true);
    expect(isSameRow({ round: 2 }, { round: 2, turn: 1 })).toBe(false);
  });

  it('matches a turn row by its round and turn', () => {
    expect(isSameRow({ round: 2, turn: 1 }, { round: 2, turn: 1 })).toBe(true);
    expect(isSameRow({ round: 2, turn: 1 }, { round: 2, turn: 2 })).toBe(false);
  });
});

describe('stopRows', () => {
  const rows = [
    { round: 1 },
    { round: 2 },
    { round: 2, turn: 1 },
    { round: 2, turn: 2 },
    { round: 3 },
  ];

  it('drops the selected round’s own row when a turn of it is selected', () => {
    expect(stopRows(rows, { round: 2, turn: 2 })).toEqual([
      { round: 1 },
      { round: 2, turn: 1 },
      { round: 2, turn: 2 },
      { round: 3 },
    ]);
  });

  it('keeps the selected round’s row when it has no turns to stop on', () => {
    expect(stopRows(rows, { round: 3, turn: undefined })).toEqual(rows);
  });

  it('keeps every row when nothing is selected', () => {
    expect(stopRows(rows, undefined)).toEqual(rows);
  });
});

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
    const decision: Decision = { id: 'd3', runId: 'run', round: 2, on: { kind: 'turn', turn: 1 } };
    expect(findWaitingStep([decision], 'run', 2)).toBeUndefined();
  });
});

describe('findAwaitingTurn', () => {
  it('finds the decision a turn waits on', () => {
    const decision: Decision = { id: 'd1', runId: 'run', round: 2, on: { kind: 'turn', turn: 1 } };
    expect(findAwaitingTurn([decision], 'run', 2, 1)).toEqual(decision);
    expect(findAwaitingTurn([decision], 'run', 2, 2)).toBeUndefined();
  });
});
