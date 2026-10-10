import { describe, expect, it } from 'vitest';
import type { Round, Turn } from '../state/inspector-state.ts';
import {
  formatRetry,
  optionKindLabel,
  optionProbability,
  turnStatusLabel,
} from './turn-display.ts';

const baseTurn = (overrides: Partial<Turn> = {}): Turn => ({
  turn: 1,
  request: { state: { goal: 'g' }, questions: {} },
  optionInfo: {},
  retries: [],
  outcome: { status: 'asked' },
  ...overrides,
});

const baseRound = (overrides: Partial<Round> = {}): Round => ({
  round: 1,
  context: { goal: 'g' },
  ops: [],
  picks: [{ maxOptions: 26 }],
  turns: [],
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
