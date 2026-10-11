import type { OpTreeNode } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { Round, Turn } from '../state/inspector-state.ts';
import { optionLine, roundOutcome, turnCount, turnTip } from './rail-tips.ts';

const ops: OpTreeNode[] = [
  {
    kind: 'group',
    address: { keys: ['hn'] },
    description: 'Hacker News',
    children: [
      { kind: 'op', address: { keys: ['hn', 'upvote'] }, description: 'Open link "upvote"' },
    ],
  },
];

const turn = (outcome: Turn['outcome'], overrides: Partial<Turn> = {}): Turn => ({
  turn: 1,
  request: {
    state: { goal: 'g' },
    questions: {
      achieved: {
        instructions: 'Is the goal achieved?',
        criteria: { achieved: 'Goal achieved: g', notYet: 'Goal not achieved yet' },
      },
      next: { instructions: 'What should happen next?', criteria: { o1: 'Hacker News\nmore' } },
    },
  },
  edits: [],
  optionInfo: {},
  retries: [],
  outcome,
  ...overrides,
});

const round = (overrides: Partial<Round> = {}): Round => ({
  round: 1,
  context: { goal: 'g' },
  ops,
  picks: [],
  dropped: { inputTokens: 0, requests: 0 },
  turns: [],
  ...overrides,
});

const picked = {
  step: 'hn.upvote',
  address: { keys: ['hn', 'upvote'] },
  probabilities: [],
  tokens: 0,
  ms: 0,
};

describe('turnCount', () => {
  it('counts the turns', () => {
    expect(turnCount(round())).toBe('no turns');
    expect(turnCount(round({ turns: [turn({ status: 'asked' })] }))).toBe('1 turn');
  });
});

describe('roundOutcome', () => {
  it('names the move a round ran, as the model read it', () => {
    expect(
      roundOutcome(round({ picked, invoked: { step: 'hn.upvote', ms: 1 } }), undefined),
    ).toEqual({
      label: 'Ran',
      move: 'Open link "upvote"',
      tone: 'plain',
    });
  });

  it('says where a current round stands, coral when it needs you', () => {
    expect(roundOutcome(round(), 'waiting-for-you')).toMatchObject({ tone: 'you' });
    expect(roundOutcome(round({ picked }), 'waiting-to-run')).toMatchObject({
      label: 'Ready to run',
      tone: 'you',
    });
    expect(roundOutcome(round(), 'in-flight')).toMatchObject({ label: 'The model is answering' });
  });

  it('says a failed step and a met goal', () => {
    expect(
      roundOutcome(
        round({ picked, invoked: { step: 'hn.upvote', ms: 1, error: 'boom\nstack' } }),
        undefined,
      ),
    ).toEqual({ label: 'Failed', move: 'boom', tone: 'you' });
    expect(
      roundOutcome(round({ goalChecked: { achieved: true, ms: 1 } }), undefined),
    ).toMatchObject({
      label: 'Goal achieved',
    });
  });
});

describe('turnTip', () => {
  it('lists each question with the first line of its answer', () => {
    const answered = turn({
      status: 'answered',
      by: { kind: 'you' },
      answers: {
        achieved: { choice: 'notYet', probabilities: {} },
        next: { choice: 'o1', probabilities: {} },
      },
      inputTokens: 0,
      ms: 1,
    });
    expect(turnTip(answered, undefined)).toEqual({
      kind: 'answers',
      answers: [
        { question: 'Is the goal achieved?', answer: 'Goal not achieved yet' },
        { question: 'What should happen next?', answer: 'Hacker News' },
      ],
    });
  });

  it('says a waiting turn waits for you, or for you to confirm the model', () => {
    expect(turnTip(turn({ status: 'asked' }), 'waiting-for-you')).toMatchObject({
      text: 'Waiting for you',
    });
    const suggestion = {
      by: { kind: 'model' as const, name: 'jev', endpoint: 'e' },
      answers: {},
      inputTokens: 1,
      ms: 1,
    };
    expect(turnTip(turn({ status: 'asked' }, { suggestion }), 'waiting-for-you')).toMatchObject({
      text: 'Waiting for you to confirm',
    });
  });
});

describe('optionLine', () => {
  it('reads a group by its name, and a bundle by what it holds', () => {
    expect(optionLine('More moves — contains:\n  Double it\n  Reset')).toBe('More moves');
    expect(optionLine('Contains:\n  Early human migrations\n  Paleo-Indians')).toBe(
      'Early human migrations, Paleo-Indians',
    );
    expect(optionLine('Add one')).toBe('Add one');
  });
});
