import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { PickedStep, Round, Turn } from '../state/inspector-state.ts';
import { pickedOp, roundHeadline, roundProbability } from './round-title.ts';

const ops: OpTreeNode[] = [
  {
    kind: 'choices',
    address: { keys: ['openLink'] },
    description: 'Open a link',
    children: [
      { kind: 'choice', address: { keys: ['openLink'], choice: 0 }, label: 'Banana' },
      { kind: 'choice', address: { keys: ['openLink'], choice: 1 }, label: 'Domestication' },
    ],
  },
  {
    kind: 'group',
    address: { keys: ['more'] },
    description: 'More moves',
    children: [
      { kind: 'op', address: { keys: ['more', 'reset'] }, description: 'Reset to zero' },
      {
        kind: 'choices',
        address: { keys: ['more', 'set'] },
        description: 'Set it',
        children: [{ kind: 'choice', address: { keys: ['more', 'set'], choice: 3 }, label: '3' }],
      },
    ],
  },
  { kind: 'op', address: { keys: ['add'] }, description: 'Add one' },
];

const picked = (overrides: Partial<PickedStep> = {}): PickedStep => ({
  step: 'openLink("Domestication")',
  address: { keys: ['openLink'], choice: 1 },
  probabilities: [1, 0.2, 0.64],
  tokens: 10,
  ms: 5,
  ...overrides,
});

const round = (overrides: Partial<Round> = {}): Round => ({
  round: 1,
  context: { goal: 'g' },
  ops,
  picks: [{ maxOptions: 26 }],
  turns: [],
  ...overrides,
});

describe('pickedOp', () => {
  it('reads a choice as its list keys and its label, described by the list and the label', () => {
    expect(pickedOp(ops, { keys: ['openLink'], choice: 1 })).toEqual({
      title: { kind: 'choice', keys: ['openLink'], label: 'Domestication' },
      subtitle: 'openLink',
      description: 'Open a link › Domestication',
    });
  });

  it('reads a choice under a group with the group keys in its prefix', () => {
    expect(pickedOp(ops, { keys: ['more', 'set'], choice: 3 })).toEqual({
      title: { kind: 'choice', keys: ['more', 'set'], label: '3' },
      subtitle: 'more.set',
      description: 'More moves › Set it › 3',
    });
  });

  it('reads a plain op at the top as its key, described by itself alone', () => {
    expect(pickedOp(ops, { keys: ['add'] })).toEqual({
      title: { kind: 'op', prefix: [], key: 'add' },
      subtitle: 'Add one',
      description: 'Add one',
    });
  });

  it('reads a plain op in a group as the group keys, described by its group and itself', () => {
    expect(pickedOp(ops, { keys: ['more', 'reset'] })).toEqual({
      title: { kind: 'op', prefix: ['more'], key: 'reset' },
      subtitle: 'more',
      description: 'More moves › Reset to zero',
    });
  });

  it('returns null for an address the tree does not hold', () => {
    expect(pickedOp(ops, { keys: ['openLink'], choice: 99 })).toBeNull();
    expect(pickedOp(ops, { keys: ['more'] })).toBeNull();
  });

  it('does not match a plain op to a choice list with the same keys', () => {
    expect(pickedOp(ops, { keys: ['openLink'] })).toBeNull();
  });
});

const notWaiting = { isYourTurn: false, isWaitingToRun: false };

describe('roundHeadline', () => {
  it('says "Your turn" over everything when a turn of the round waits for the developer', () => {
    expect(
      roundHeadline(round({ picked: picked() }), { isYourTurn: true, isWaitingToRun: true }),
    ).toEqual({ kind: 'your-turn' });
  });

  it('says the pick is made but not run when its step waits to run', () => {
    expect(
      roundHeadline(round({ picked: picked() }), { isYourTurn: false, isWaitingToRun: true }),
    ).toEqual({ kind: 'pick-made' });
  });

  it('gives the picked op, its title and its description', () => {
    expect(roundHeadline(round({ picked: picked() }), notWaiting)).toEqual({
      kind: 'title',
      picked: {
        title: { kind: 'choice', keys: ['openLink'], label: 'Domestication' },
        subtitle: 'openLink',
        description: 'Open a link › Domestication',
      },
    });
  });

  it('says "goal achieved" for a goal step, which has no address', () => {
    expect(
      roundHeadline(round({ picked: picked({ address: null, step: 'goal' }) }), notWaiting),
    ).toEqual({ kind: 'goal' });
  });

  it('says "goal achieved" when the goal was met before any pick', () => {
    expect(roundHeadline(round({ goalChecked: { achieved: true, ms: 1 } }), notWaiting)).toEqual({
      kind: 'goal',
    });
  });

  it('is pending before a pick, with the goal unmet or unchecked', () => {
    expect(roundHeadline(round(), notWaiting)).toEqual({ kind: 'pending' });
    expect(roundHeadline(round({ goalChecked: { achieved: false, ms: 1 } }), notWaiting)).toEqual({
      kind: 'pending',
    });
  });

  it('falls back to the step text when the address is not in the tree', () => {
    const address = { keys: ['gone'] };
    expect(
      roundHeadline(round({ picked: picked({ address, step: 'gone()' }) }), notWaiting),
    ).toEqual({
      kind: 'step',
      step: 'gone()',
    });
  });
});

describe('roundProbability', () => {
  it('shows the last probability of the pick', () => {
    expect(roundProbability(round({ picked: picked() }))).toBe('.64');
  });

  it('shows a dash when nothing was picked', () => {
    expect(roundProbability(round())).toBe('—');
  });

  it('says you when you answered a turn of the pick, rather than its probability of 1', () => {
    const yours: Turn = {
      turn: 1,
      request: { state: { goal: 'g' }, questions: {} },
      optionInfo: {},
      retries: [],
      outcome: { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 },
    };
    expect(roundProbability(round({ picked: picked(), turns: [yours] }))).toBe('you');
  });

  it('shows a dash for a goal step with no probabilities', () => {
    expect(roundProbability(round({ picked: picked({ address: null, probabilities: [] }) }))).toBe(
      '—',
    );
  });
});
