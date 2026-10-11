import { describe, expect, it } from 'vitest';
import type { Decision } from '../state/inspector-state.ts';
import { canPickAgainFrom, pickAgainNote } from './pick-again.ts';

const onTurn = (turn: number, isReview = false): Decision => ({
  id: 'd1',
  runId: 'r1',
  round: 1,
  on: { kind: 'turn', turn, isReview },
});

describe('canPickAgainFrom', () => {
  it('offers the turns before the one the round waits on, never that turn', () => {
    expect(canPickAgainFrom(1, onTurn(3))).toBe(true);
    expect(canPickAgainFrom(3, onTurn(3))).toBe(false);
    expect(canPickAgainFrom(3, onTurn(3, true))).toBe(false);
  });

  it('offers every turn while the step waits, and none while nothing waits', () => {
    const step: Decision = { id: 'd2', runId: 'r1', round: 1, on: { kind: 'step', step: 'a' } };
    expect(canPickAgainFrom(3, step)).toBe(true);
    expect(canPickAgainFrom(1, undefined)).toBe(false);
  });
});

describe('pickAgainNote', () => {
  it('names the turns it clears', () => {
    expect(pickAgainNote(2, 4)).toBe('Turns 2 to 4 are cleared, and turn 2 is asked again.');
    expect(pickAgainNote(3, 4)).toBe('Turns 3 and 4 are cleared, and turn 3 is asked again.');
    expect(pickAgainNote(4, 4)).toBe('Turn 4 is cleared and asked again.');
  });
});
