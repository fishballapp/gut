import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { Round, Run } from '../state/inspector-state.ts';
import {
  abandonedPickedSteps,
  choiceWindow,
  closedCountLabel,
  countMoves,
  roundSummaryLine,
} from './round-panel.ts';

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
  turns: [],
});

describe('countMoves and closedCountLabel', () => {
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
    expect(closedCountLabel(tree)).toBe('· 3 moves');
  });

  it('labels a choices node by its choice count', () => {
    const choices = tree.children[1];
    if (choices?.kind !== 'choices') throw new Error('expected choices');
    expect(closedCountLabel(choices)).toBe('· 2 choices');
  });
});

describe('choiceWindow', () => {
  it('returns all when the list fits', () => {
    expect(choiceWindow(10, 3)).toBe('all');
  });

  it('centers on the picked choice', () => {
    expect(choiceWindow(100, 50, 12)).toEqual({ start: 45, end: 57 });
  });

  it('clamps to the start and end of the list', () => {
    expect(choiceWindow(100, 2, 12)).toEqual({ start: 0, end: 12 });
    expect(choiceWindow(100, 98, 12)).toEqual({ start: 88, end: 100 });
  });

  it('shows the head when nothing is picked', () => {
    expect(choiceWindow(100, undefined, 12)).toEqual({ start: 0, end: 12 });
  });
});

describe('roundSummaryLine', () => {
  it('describes a picked step', () => {
    const round: Round = {
      ...baseRound(),
      picked: {
        step: 'add',
        address: { keys: ['add'] },
        probabilities: [0.58, 0.64],
        tokens: 5984,
        ms: 3100,
      },
    };
    expect(roundSummaryLine(round, run(true))).toEqual({
      kind: 'picked',
      step: 'add',
      probabilities: '.58 → .64',
      meta: '3.1s · 5,984 tokens',
    });
  });

  it('says the goal was checked in code when achieved with no pick', () => {
    const round: Round = { ...baseRound(), goalChecked: { achieved: true, ms: 1 } };
    expect(roundSummaryLine(round, run(true))).toEqual({
      kind: 'goal',
      text: 'checked in code: achieved',
    });
    expect(roundSummaryLine(round, run(false))).toEqual({
      kind: 'goal',
      text: 'goal achieved',
    });
  });

  it('says goal achieved when the pick has a null address', () => {
    const round: Round = {
      ...baseRound(),
      picked: { step: 'goal', address: null, probabilities: [1], tokens: 10, ms: 100 },
    };
    expect(roundSummaryLine(round, run(false))).toEqual({
      kind: 'goal',
      text: 'goal achieved',
    });
  });

  it('says not picked yet while the round is open', () => {
    expect(roundSummaryLine(baseRound(), run(true))).toEqual({
      kind: 'pending',
      text: 'not picked yet',
    });
  });
});

describe('abandonedPickedSteps', () => {
  it('lists steps from abandoned picks that settled', () => {
    const round: Round = {
      ...baseRound(),
      picks: [
        {
          maxOptions: 26,
          abandoned: { inputTokens: 10, requests: 1 },
          picked: {
            step: 'add',
            address: { keys: ['add'] },
            probabilities: [1],
            tokens: 10,
            ms: 1,
          },
        },
        { maxOptions: 26, abandoned: { inputTokens: 0, requests: 0 } },
        { maxOptions: 26 },
      ],
    };
    expect(abandonedPickedSteps(round)).toEqual(['add']);
  });
});
