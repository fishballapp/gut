import { describe, expect, it } from 'vitest';
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import {
  adjacentRound,
  blockLook,
  blockName,
  chosenProbability,
  isRoundWaiting,
  isStepWaiting,
} from './strip-block.ts';

const turn = (number: number, outcome: Turn['outcome']): Turn => ({
  turn: number,
  pick: 1,
  request: { state: { goal: 'g' }, questions: {} },
  optionInfo: {},
  retries: [],
  outcome,
});

const modelAnswered = (
  answers: Extract<Turn['outcome'], { status: 'answered' }>['answers'],
): Turn['outcome'] => ({
  status: 'answered',
  by: { kind: 'model', name: 'Jev', endpoint: 'e' },
  answers,
  inputTokens: 1,
  ms: 1,
});

const waitingOnTurn = (turnNumber: number): Decision => ({
  id: `d${turnNumber}`,
  runId: 'r',
  round: 3,
  on: { kind: 'turn', turn: turnNumber },
});

describe('chosenProbability', () => {
  it('reads the next question when the turn has one', () => {
    const answers = {
      next: { choice: 'o2', probabilities: { o1: 0.3, o2: 0.64 } },
      achieved: { choice: 'notYet', probabilities: { notYet: 1 } },
    };
    expect(chosenProbability(answers)).toBe(0.64);
  });

  it('reads the goal when the model judged it met, even with a move asked beside it', () => {
    const answers = {
      next: { choice: 'o1', probabilities: { o1: 0.8 } },
      achieved: { choice: 'achieved', probabilities: { achieved: 0.3, notYet: 0.7 } },
    };
    expect(chosenProbability(answers)).toBe(0.3);
  });

  it('reads the goal when the turn only asked the goal', () => {
    const answers = { achieved: { choice: 'notYet', probabilities: { notYet: 0.9 } } };
    expect(chosenProbability(answers)).toBe(0.9);
  });

  it('is 0 for a chosen option with no probability', () => {
    const answers = { next: { choice: 'o1', probabilities: {} } };
    expect(chosenProbability(answers)).toBe(0);
  });
});

describe('blockLook', () => {
  const pending: Decision[] = [waitingOnTurn(2)];
  const look = (outcome: Turn['outcome'], turnNumber = 1) =>
    blockLook({
      runId: 'r',
      round: 3,
      turn: turn(turnNumber, outcome),
      pending,
    });

  it('shows a model answer by its chosen probability', () => {
    const outcome = modelAnswered({ next: { choice: 'o1', probabilities: { o1: 0.64 } } });
    expect(look(outcome)).toEqual({ kind: 'model', probability: 0.64 });
  });

  it('shows a turn you answered without a probability', () => {
    const outcome: Turn['outcome'] = {
      status: 'answered',
      by: { kind: 'you' },
      answers: { next: { choice: 'o1', probabilities: { o1: 1 } } },
      inputTokens: 0,
      ms: 0,
    };
    expect(look(outcome)).toEqual({ kind: 'you' });
  });

  it('shows a dropped turn with its reason', () => {
    expect(look({ status: 'dropped', reason: 'repick' })).toEqual({
      kind: 'dropped',
      reason: 'repick',
    });
    expect(look({ status: 'dropped', reason: 'budget' })).toEqual({
      kind: 'dropped',
      reason: 'budget',
    });
  });

  it('shows a failed turn', () => {
    expect(look({ status: 'failed', error: 'boom', isTooLarge: false })).toEqual({
      kind: 'failed',
    });
  });

  it('shows an asked turn that something waits on as waiting for you', () => {
    expect(look({ status: 'asked' }, 2)).toEqual({ kind: 'waiting' });
  });

  it('shows an asked turn nothing waits on as in flight', () => {
    expect(look({ status: 'asked' }, 1)).toEqual({ kind: 'in-flight' });
  });

  it('does not mark a turn waiting when the decision is for another round', () => {
    const otherRound = blockLook({
      runId: 'r',
      round: 4,
      turn: turn(2, { status: 'asked' }),
      pending,
    });
    expect(otherRound).toEqual({ kind: 'in-flight' });
  });

  it('lets a failed turn win over a decision that still names it', () => {
    expect(look({ status: 'failed', error: 'boom', isTooLarge: false }, 2)).toEqual({
      kind: 'failed',
    });
  });
});

describe('blockName', () => {
  it('names the round, turn and what the block shows', () => {
    expect(blockName(3, 2, { kind: 'model', probability: 0.64 })).toBe(
      'round 3, turn 2: .64, answered by the model',
    );
    expect(blockName(3, 2, { kind: 'you' })).toBe('round 3, turn 2: answered by you');
    expect(blockName(3, 2, { kind: 'dropped', reason: 'budget' })).toBe(
      'round 3, turn 2: dropped, the budget ran out',
    );
    expect(blockName(3, 2, { kind: 'waiting' })).toBe('round 3, turn 2: waiting for you');
  });
});

describe('isRoundWaiting and isStepWaiting', () => {
  const pending: Decision[] = [
    waitingOnTurn(2),
    { id: 's', runId: 'r', round: 4, on: { kind: 'step', step: 'openLink' } },
  ];

  it('sees a turn waiting on its round', () => {
    expect(isRoundWaiting('r', 3, pending)).toBe(true);
    expect(isStepWaiting('r', 3, pending)).toBe(false);
  });

  it('sees a picked step waiting on its round', () => {
    expect(isRoundWaiting('r', 4, pending)).toBe(true);
    expect(isStepWaiting('r', 4, pending)).toBe(true);
  });

  it('ignores other runs and rounds', () => {
    expect(isRoundWaiting('other', 3, pending)).toBe(false);
    expect(isRoundWaiting('r', 1, pending)).toBe(false);
  });
});

describe('adjacentRound', () => {
  const rounds = [1, 2, 3].map(
    (round): Round => ({ round, context: { goal: 'g' }, ops: [], picks: [], turns: [] }),
  );

  it('steps to the neighbouring round', () => {
    expect(adjacentRound(rounds, 2, 1)?.round).toBe(3);
    expect(adjacentRound(rounds, 2, -1)?.round).toBe(1);
  });

  it('is undefined past either end', () => {
    expect(adjacentRound(rounds, 1, -1)).toBeUndefined();
    expect(adjacentRound(rounds, 3, 1)).toBeUndefined();
  });

  it('is undefined for a round the run does not have', () => {
    expect(adjacentRound(rounds, 9, 1)).toBeUndefined();
  });
});
