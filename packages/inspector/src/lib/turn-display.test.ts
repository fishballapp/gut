import { describe, expect, it } from 'vitest';
import type { Decision, Turn } from '../state/inspector-state.ts';
import {
  defaultSortFor,
  formatRetry,
  optionKindLabel,
  optionProbability,
  optionRowsOf,
  optionsPhaseOf,
  turnStatusLabel,
} from './turn-display.ts';

const baseTurn = (overrides: Partial<Turn> = {}): Turn => ({
  turn: 1,
  request: { state: { goal: 'g' }, questions: {} },
  edits: [],
  optionInfo: {},
  retries: [],
  outcome: { status: 'asked' },
  ...overrides,
});

describe('optionKindLabel', () => {
  it('labels each kind, and leaves moves blank', () => {
    expect(optionKindLabel({ kind: 'move', address: { keys: ['a'] } })).toBeUndefined();
    expect(optionKindLabel({ kind: 'group', address: { keys: ['g'] }, moves: 4 })).toBe(
      'group · 4 moves',
    );
    expect(optionKindLabel({ kind: 'choices', address: { keys: ['c'] }, moves: 3 })).toBe(
      'choices · 3',
    );
    expect(optionKindLabel({ kind: 'bundle', size: 24 })).toBe('bundle · 24');
    expect(optionKindLabel({ kind: 'bundle' })).toBe('bundle');
    expect(optionKindLabel({ kind: 'back' })).toBe('go back');
  });
});

describe('formatRetry', () => {
  it('prefers the status code when present', () => {
    expect(formatRetry({ delayMs: 1000, status: 503 })).toBe('503 · retried after 1.0s');
  });

  it('falls back to the error text', () => {
    expect(formatRetry({ delayMs: 500, error: 'ECONNRESET' })).toBe(
      'ECONNRESET · retried after 500ms',
    );
  });
});

describe('turnStatusLabel', () => {
  it('covers each outcome', () => {
    expect(turnStatusLabel(baseTurn())).toBe('waiting');
    expect(
      turnStatusLabel(baseTurn({ outcome: { status: 'failed', error: 'x', isTooLarge: false } })),
    ).toBe('failed');
    expect(turnStatusLabel(baseTurn({ outcome: { status: 'dropped', reason: 'budget' } }))).toBe(
      'dropped: the budget ran out',
    );
    expect(
      turnStatusLabel(
        baseTurn({
          outcome: {
            status: 'answered',
            by: { kind: 'you' },
            answers: {},
            inputTokens: 0,
            ms: 9200,
          },
        }),
      ),
    ).toBe('answered by you · 9.2s');
    expect(
      turnStatusLabel(
        baseTurn({
          outcome: {
            status: 'answered',
            by: { kind: 'model', name: 'clef-flash', endpoint: 'http://localhost' },
            answers: {},
            inputTokens: 2880,
            ms: 1400,
          },
        }),
      ),
    ).toBe('answered by clef-flash · 2,880 tokens · 1.4s');
  });
});

describe('optionProbability', () => {
  it('treats a you-pick as 1 and the rest as 0', () => {
    const turn = baseTurn({
      outcome: {
        status: 'answered',
        by: { kind: 'you' },
        answers: { next: { choice: 'o2', probabilities: { o2: 1 } } },
        inputTokens: 0,
        ms: 100,
      },
    });
    expect(optionProbability(turn, 'next', 'o2')).toBe(1);
    expect(optionProbability(turn, 'next', 'o1')).toBe(0);
  });

  it('reads model probabilities', () => {
    const turn = baseTurn({
      outcome: {
        status: 'answered',
        by: { kind: 'model', name: 'clef-flash', endpoint: 'http://localhost' },
        answers: { next: { choice: 'o1', probabilities: { o1: 0.64, o2: 0.36 } } },
        inputTokens: 10,
        ms: 100,
      },
    });
    expect(optionProbability(turn, 'next', 'o1')).toBe(0.64);
    expect(optionProbability(turn, 'next', 'missing')).toBe(0);
  });
});

describe('defaultSortFor', () => {
  it('opens a turn the model answered by probability', () => {
    const turn = baseTurn({
      outcome: {
        status: 'answered',
        by: { kind: 'model', name: 'Jev', endpoint: 'e' },
        answers: {},
        inputTokens: 1,
        ms: 1,
      },
    });
    expect(defaultSortFor(turn)).toBe('by-probability');
  });

  it('opens a turn you answered, or one still waiting, as sent', () => {
    const youAnswered = baseTurn({
      outcome: { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 },
    });
    expect(defaultSortFor(youAnswered)).toBe('as-sent');
    expect(defaultSortFor(baseTurn())).toBe('as-sent');
    expect(defaultSortFor(undefined)).toBe('as-sent');
  });
});

describe('optionsPhaseOf', () => {
  const waiting = (isReview: boolean): Decision => ({
    id: 'd1',
    runId: 'r1',
    round: 1,
    on: { kind: 'turn', turn: 1, isReview },
  });

  it('chooses while a turn waits for your answer, whatever the outcome', () => {
    expect(optionsPhaseOf(baseTurn(), waiting(false))).toBe('choose');
  });

  it("reviews while the model's answer waits for you", () => {
    expect(optionsPhaseOf(baseTurn(), waiting(true))).toBe('review');
  });

  it('asks while the model answers an asked turn nobody is waiting on', () => {
    expect(optionsPhaseOf(baseTurn(), undefined)).toBe('asking');
  });

  it('reads back every settled turn', () => {
    expect(
      optionsPhaseOf(baseTurn({ outcome: { status: 'dropped', reason: 'budget' } }), undefined),
    ).toBe('read');
    expect(
      optionsPhaseOf(
        baseTurn({ outcome: { status: 'failed', error: 'x', isTooLarge: false } }),
        undefined,
      ),
    ).toBe('read');
  });
});

describe("the model's suggestion", () => {
  const suggestion = {
    by: { kind: 'model' as const, name: 'jev', endpoint: 'https://e.invalid' },
    answers: { next: { choice: 'a', probabilities: { a: 0.7, b: 0.3 } } },
    inputTokens: 1200,
    ms: 900,
  };

  it('shows its probabilities while it waits, and once you replaced it', () => {
    const held = baseTurn({ suggestion });
    expect(optionProbability(held, 'next', 'b')).toBe(0.3);
    const replaced = baseTurn({
      suggestion,
      outcome: {
        status: 'answered',
        by: { kind: 'you' },
        answers: { next: { choice: 'b', probabilities: { b: 1 } } },
        inputTokens: 1200,
        ms: 4000,
      },
    });
    expect(optionProbability(replaced, 'next', 'a')).toBe(0.7);
    expect(defaultSortFor(replaced)).toBe('by-probability');
    expect(turnStatusLabel(replaced)).toBe('answered by you · 1,200 tokens · 4.0s');
  });

  it('says who suggested it while it waits', () => {
    expect(turnStatusLabel(baseTurn({ suggestion }))).toBe(
      'suggested by jev · 1,200 tokens · 900ms',
    );
  });
});

describe('optionRowsOf', () => {
  const pick = { instructions: 'Pick', criteria: { a: 'first', b: 'second' } };
  const turn = baseTurn({
    request: { state: { goal: 'g' }, questions: { pick } },
    edits: [],
    optionInfo: { pick: { b: { kind: 'group', address: { keys: ['g'] }, moves: 2 } } },
    outcome: {
      status: 'answered',
      by: { kind: 'model', name: 'clef', endpoint: 'http://localhost' },
      answers: { pick: { choice: 'b', probabilities: { a: 0.25, b: 0.75 } } },
      inputTokens: 10,
      ms: 5,
    },
  });

  it('lists the options as sent, with their kind and probability', () => {
    expect(optionRowsOf(turn, 'pick', pick)).toEqual([
      { key: 'a', text: 'first', kindLabel: undefined, index: 0, probability: 0.25 },
      { key: 'b', text: 'second', kindLabel: 'group · 2 moves', index: 1, probability: 0.75 },
    ]);
  });
});
