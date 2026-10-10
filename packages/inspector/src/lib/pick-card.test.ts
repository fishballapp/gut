import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { PickedStep, Round, Turn } from '../state/inspector-state.ts';
import { pickTrail, stepCall } from './pick-card.ts';

const ops: OpTreeNode[] = [
  {
    kind: 'choices',
    address: { keys: ['openLink'] },
    description: 'Open a link',
    children: [
      { kind: 'choice', address: { keys: ['openLink'], choice: 2 }, label: 'Roman Empire' },
    ],
  },
  {
    kind: 'group',
    address: { keys: ['more'] },
    description: 'More moves',
    children: [{ kind: 'op', address: { keys: ['more', 'reset'] }, description: 'Reset' }],
  },
];

const picked = (overrides: Partial<PickedStep> = {}): PickedStep => ({
  step: 'openLink("Roman Empire")',
  address: { keys: ['openLink'], choice: 2 },
  probabilities: [],
  tokens: 0,
  ms: 1,
  ...overrides,
});

const turn = (number: number, pick: number, outcome: Turn['outcome']): Turn => ({
  turn: number,
  pick,
  request: { state: { goal: 'g' }, questions: {} },
  optionInfo: {},
  retries: [],
  outcome,
});

const round = (overrides: Partial<Round> = {}): Round => ({
  round: 4,
  context: { goal: 'g' },
  ops,
  picks: [{ maxOptions: 9 }],
  turns: [],
  ...overrides,
});

describe('stepCall', () => {
  it('writes a choice as its op and quoted label, as the sidebar names it', () => {
    expect(stepCall(round(), picked())).toBe('openLink("Roman Empire")');
  });

  it('writes a plain op as its dotted key', () => {
    const address = { keys: ['more', 'reset'] };
    expect(stepCall(round(), picked({ address, step: 'more.reset' }))).toBe('more.reset');
  });

  it('falls back to the recorded step when the address is not in the tree', () => {
    const address = { keys: ['gone'] };
    expect(stepCall(round(), picked({ address, step: 'gone()' }))).toBe('gone()');
  });

  it('shows the goal step as recorded, since it has no address', () => {
    expect(stepCall(round(), picked({ address: null, step: 'goal' }))).toBe('goal');
  });
});

describe('pickTrail', () => {
  it('lists the answered turns of the current pick, by who answered', () => {
    const turns = [
      turn(1, 1, { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 }),
      turn(2, 1, {
        status: 'answered',
        by: { kind: 'model', name: 'Jev', endpoint: 'e' },
        answers: {},
        inputTokens: 10,
        ms: 1,
      }),
    ];
    expect(pickTrail(round({ turns, picks: [{ maxOptions: 9 }] }))).toEqual([
      { turn: 1, by: 'you' },
      { turn: 2, by: 'Jev' },
    ]);
  });

  it('leaves out the turns of a pick a re-pick abandoned', () => {
    const turns = [
      turn(1, 1, { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 }),
      turn(2, 2, { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 }),
    ];
    expect(pickTrail(round({ turns, picks: [{ maxOptions: 9 }, { maxOptions: 9 }] }))).toEqual([
      { turn: 2, by: 'you' },
    ]);
  });
});
