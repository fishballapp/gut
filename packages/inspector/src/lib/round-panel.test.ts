import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { Round, Run } from '../state/inspector-state.ts';
import { countLabel, countMoves, nodeTag, roundNote } from './round-panel.ts';

const run = (isGoalCheckedInCode: boolean): Run => ({
  runId: 'r',
  name: 'n',
  model: null,
  inputTokenBudget: 1000,
  isGoalCheckedInCode,
  rounds: [],
});

const baseRound = (): Round => ({
  round: 1,
  context: { goal: 'g' },
  ops: [],
  picks: [],
  dropped: { inputTokens: 0, requests: 0 },
  turns: [],
});

describe('countMoves and countLabel', () => {
  const tree: OpTreeNode = {
    kind: 'group',
    address: { keys: ['more'] },
    description: 'More',
    children: [
      { kind: 'op', address: { keys: ['more', 'double'] }, description: 'Double' },
      {
        kind: 'choices',
        address: { keys: ['more', 'set'] },
        description: 'Set',
        children: [
          { kind: 'choice', address: { keys: ['more', 'set'], choice: 0 }, label: '0' },
          { kind: 'choice', address: { keys: ['more', 'set'], choice: 1 }, label: '1' },
        ],
      },
    ],
  };

  it('counts ops and choices as leaf moves', () => {
    expect(countMoves(tree)).toBe(3);
    expect(countLabel(tree)).toBe('(3 moves)');
    expect(nodeTag(tree)).toBe('Group');
  });

  it('labels a choices node by its choice count', () => {
    const choices = tree.children[1];
    if (choices?.kind !== 'choices') throw new Error('expected choices');
    expect(countLabel(choices)).toBe('(2 choices)');
    expect(nodeTag(choices)).toBe('Op');
    expect(nodeTag(choices.children[0] ?? tree)).toBeUndefined();
  });
});

describe('roundNote', () => {
  it('says nothing for a round that ran its step', () => {
    expect(roundNote(baseRound(), run(false))).toBeUndefined();
  });

  it('says a failed step', () => {
    const round = { ...baseRound(), invoked: { step: 'add', ms: 1, error: 'boom' } };
    expect(roundNote(round, run(false))).toEqual({ kind: 'error', text: 'boom' });
  });

  it('says a goal met by the model, or checked in code', () => {
    const picked = { step: 'goal', address: null, probabilities: [], tokens: 0, ms: 0 };
    expect(roundNote({ ...baseRound(), picked }, run(false))).toEqual({
      kind: 'goal',
      text: 'Goal achieved',
    });
    const checked = { ...baseRound(), goalChecked: { achieved: true, ms: 1 } };
    expect(roundNote(checked, run(true))).toEqual({
      kind: 'goal',
      text: 'Goal achieved, checked in code',
    });
  });
});
