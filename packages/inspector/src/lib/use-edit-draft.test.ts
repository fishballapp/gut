import { describe, expect, it } from 'vitest';
import type { Round, Run } from '../state/inspector-state.ts';
import { draftOf } from './edit-draft.ts';
import { draftIn, type Editing } from './use-edit-draft.ts';

const run = { runId: 'r1' } as Run;
const roundWith = (picks: number) =>
  ({ round: 1, picks: Array.from({ length: picks }, () => ({})) }) as unknown as Round;
const context = { goal: 'done' };
const editing: Editing = { runId: 'r1', round: 1, draft: draftOf([], context) };

describe('draftIn', () => {
  it('keeps the draft through a re-pick of its round, which adds a pick', () => {
    expect(draftIn(editing, run, roundWith(1))).toBe(editing.draft);
    expect(draftIn(editing, run, roundWith(2))).toBe(editing.draft);
  });

  it('is none for another run or round', () => {
    expect(draftIn(editing, { runId: 'r2' } as Run, roundWith(1))).toBeUndefined();
    expect(draftIn(editing, run, { ...roundWith(1), round: 2 })).toBeUndefined();
  });

  it('is none when nothing is being edited', () => {
    expect(draftIn(undefined, run, roundWith(1))).toBeUndefined();
  });
});
