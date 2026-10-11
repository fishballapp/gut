import { describe, expect, it } from 'vitest';
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import {
  currentTurnOf,
  isAwaitingYou,
  roundCurrentState,
  rowCurrentState,
} from './current-turn.ts';

const turn = (number: number, outcome: Turn['outcome']): Turn => ({
  turn: number,
  request: { state: { goal: 'g' }, questions: {} },
  edits: [],
  optionInfo: {},
  retries: [],
  outcome,
});

const answered: Turn['outcome'] = {
  status: 'answered',
  by: { kind: 'model', name: 'Jev', endpoint: 'e' },
  answers: {},
  inputTokens: 1,
  ms: 1,
};

const round = (turns: Turn[] = []): Round => ({
  round: 3,
  context: { goal: 'g' },
  ops: [],
  picks: [],
  turns,
});

const turnDecision = (turnNumber: number): Decision => ({
  id: `t${turnNumber}`,
  runId: 'r',
  round: 3,
  on: { kind: 'turn', turn: turnNumber },
});

const stepDecision: Decision = {
  id: 's',
  runId: 'r',
  round: 3,
  on: { kind: 'step', step: 'openLink' },
};

describe('currentTurnOf', () => {
  it('is the asked turn the developer is to answer', () => {
    const turns = [turn(1, answered), turn(2, { status: 'asked' })];
    expect(currentTurnOf(round(turns), 'r', [turnDecision(2)])).toEqual({
      turn: 2,
      state: 'waiting-for-you',
    });
  });

  it('is the last turn of a pick whose step waits to run', () => {
    const turns = [turn(1, answered), turn(2, answered)];
    expect(currentTurnOf(round(turns), 'r', [stepDecision])).toEqual({
      turn: 2,
      state: 'waiting-to-run',
    });
  });

  it('is the asked turn the model is answering when nothing waits on the developer', () => {
    const turns = [turn(1, answered), turn(2, { status: 'asked' })];
    expect(currentTurnOf(round(turns), 'r', [])).toEqual({ turn: 2, state: 'in-flight' });
  });

  it('is undefined once every turn has an outcome and nothing waits', () => {
    expect(currentTurnOf(round([turn(1, answered)]), 'r', [])).toBeUndefined();
  });

  it('ignores a decision for another run or round', () => {
    const turns = [turn(2, { status: 'asked' })];
    const others: Decision[] = [
      { ...turnDecision(2), runId: 'other' },
      { ...turnDecision(2), round: 4 },
    ];
    expect(currentTurnOf(round(turns), 'r', others)).toEqual({ turn: 2, state: 'in-flight' });
  });
});

describe('roundCurrentState', () => {
  it('is the current turn state of a round with a current turn', () => {
    const turns = [turn(1, answered), turn(2, { status: 'asked' })];
    expect(roundCurrentState(round(turns), 'r', [turnDecision(2)])).toBe('waiting-for-you');
  });

  it('is waiting to run for a round whose pick needed no turn', () => {
    expect(roundCurrentState(round(), 'r', [stepDecision])).toBe('waiting-to-run');
  });

  it('is undefined for a round the run is not on', () => {
    expect(roundCurrentState(round([turn(1, answered)]), 'r', [])).toBeUndefined();
    expect(roundCurrentState(round(), 'r', [])).toBeUndefined();
  });
});

describe('rowCurrentState', () => {
  it('marks a collapsed round row while the run is on the round', () => {
    expect(rowCurrentState('in-flight', { isSelected: false, turnCount: 2 })).toBe('in-flight');
  });

  it('moves the marker off an open round row onto its turns', () => {
    expect(rowCurrentState('waiting-for-you', { isSelected: true, turnCount: 2 })).toBeUndefined();
  });

  it('keeps the marker on an open round row with no turn to mark', () => {
    expect(rowCurrentState('waiting-to-run', { isSelected: true, turnCount: 0 })).toBe(
      'waiting-to-run',
    );
  });

  it('is undefined for a round the run is not on', () => {
    expect(rowCurrentState(undefined, { isSelected: false, turnCount: 0 })).toBeUndefined();
  });
});

describe('isAwaitingYou', () => {
  it('is true for every state but the model answering', () => {
    expect(isAwaitingYou('waiting-for-you')).toBe(true);
    expect(isAwaitingYou('waiting-to-run')).toBe(true);
    expect(isAwaitingYou('in-flight')).toBe(false);
  });
});
