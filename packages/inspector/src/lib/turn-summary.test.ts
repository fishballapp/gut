import type { OptionInfo } from '@gut.run/core/inspector';
import { describe, expect, it } from 'vitest';
import type { Turn } from '../state/inspector-state.ts';
import { summarizeOptions, turnMark, turnSummary } from './turn-summary.ts';

const move = (keys: string[], choice?: number): OptionInfo => ({
  kind: 'move',
  address: choice === undefined ? { keys } : { keys, choice },
});
const bundle: OptionInfo = { kind: 'bundle', size: 17 };

describe('summarizeOptions', () => {
  it('counts bundles', () => {
    expect(summarizeOptions([bundle, bundle, bundle], false)).toBe('3 bundles');
  });

  it('counts a single bundle in the singular', () => {
    expect(summarizeOptions([bundle], false)).toBe('1 bundle');
  });

  it('counts groups and moves together', () => {
    const group: OptionInfo = { kind: 'group', address: { keys: ['more'] }, moves: 3 };
    expect(
      summarizeOptions([group, move(['add']), move(['x']), move(['y']), move(['z'])], false),
    ).toBe('1 group + 4 moves');
  });

  it('counts nested moves without saying where they sit', () => {
    const nested = [move(['more', 'reset']), move(['more', 'double']), move(['other', 'x'])];
    expect(summarizeOptions(nested, false)).toBe('3 moves');
  });

  it('notes the goal question', () => {
    expect(summarizeOptions([bundle, bundle], true)).toBe('2 bundles + goal');
  });

  it('says only goal for a goal-only turn', () => {
    expect(summarizeOptions([], true)).toBe('goal');
  });

  it('says no options when a turn asks none', () => {
    expect(summarizeOptions([], false)).toBe('no options');
  });

  it('counts choice lists and go-back', () => {
    const choices: OptionInfo = { kind: 'choices', address: { keys: ['set'] }, moves: 4 };
    expect(summarizeOptions([choices, { kind: 'back' }], false)).toBe('1 choice list + go back');
  });
});

const baseTurn = (overrides: Partial<Turn> = {}): Turn => ({
  turn: 2,
  request: { state: { goal: 'g' }, questions: { next: { instructions: '', criteria: {} } } },
  optionInfo: { next: { o1: bundle, o2: bundle } },
  retries: [],
  outcome: { status: 'asked' },
  ...overrides,
});

describe('turnSummary', () => {
  it('summarises the move question and notes an achieved question', () => {
    const turn = baseTurn({
      request: {
        state: { goal: 'g' },
        questions: {
          next: { instructions: '', criteria: {} },
          achieved: { instructions: '', criteria: {} },
        },
      },
    });
    expect(turnSummary(turn)).toBe('2 bundles + goal');
  });

  it('reads a turn with no move question as the goal alone', () => {
    const turn = baseTurn({
      optionInfo: {},
      request: {
        state: { goal: 'g' },
        questions: { achieved: { instructions: '', criteria: {} } },
      },
    });
    expect(turnSummary(turn)).toBe('goal');
  });
});

describe('turnMark', () => {
  it('shows the model’s input tokens compactly when it answered', () => {
    const turn = baseTurn({
      outcome: {
        status: 'answered',
        by: { kind: 'model', name: 'clef', endpoint: 'http://x' },
        answers: {},
        inputTokens: 2880,
        ms: 1,
      },
    });
    expect(turnMark(turn, undefined)).toEqual({ kind: 'text', text: '2.9k' });
  });

  it('marks a turn the developer answered as "you"', () => {
    const turn = baseTurn({
      outcome: { status: 'answered', by: { kind: 'you' }, answers: {}, inputTokens: 0, ms: 1 },
    });
    expect(turnMark(turn, undefined)).toEqual({ kind: 'text', text: 'you' });
  });

  it('shows the current turn as a marker, coral when it waits for the developer', () => {
    expect(turnMark(baseTurn(), 'waiting-for-you')).toEqual({
      kind: 'current',
      isAwaitingYou: true,
    });
  });

  it('shows the current turn as a marker, coral when its pick waits to run', () => {
    expect(turnMark(baseTurn(), 'waiting-to-run')).toEqual({
      kind: 'current',
      isAwaitingYou: true,
    });
  });

  it('shows the model’s turn in flight as a marker that needs nothing', () => {
    expect(turnMark(baseTurn(), 'in-flight')).toEqual({ kind: 'current', isAwaitingYou: false });
  });

  it('shows an ellipsis for a request still in flight that is not the current turn', () => {
    expect(turnMark(baseTurn(), undefined)).toEqual({ kind: 'text', text: '…' });
  });

  it('marks a dropped turn', () => {
    const turn = baseTurn({ outcome: { status: 'dropped', reason: 'budget' } });
    expect(turnMark(turn, undefined)).toEqual({ kind: 'text', text: 'dropped' });
  });

  it('marks a failed turn', () => {
    const turn = baseTurn({ outcome: { status: 'failed', error: 'boom', isTooLarge: false } });
    expect(turnMark(turn, undefined)).toEqual({ kind: 'text', text: 'failed' });
  });
});
