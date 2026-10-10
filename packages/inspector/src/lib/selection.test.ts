import { describe, expect, it } from 'vitest';
import { type InspectorState, initialState, type Round } from '../state/inspector-state.ts';
import {
  FOLLOWING,
  type HeldSelection,
  resolveSelection,
  selectChoice,
  selectionIn,
} from './selection.ts';

const round = (n: number, turns: number[]): Round => ({
  round: n,
  context: { goal: 'g' },
  ops: [],
  picks: [{ maxOptions: 26 }],
  turns: turns.map(turn => ({
    turn,
    request: { state: { goal: 'g' }, questions: {} },
    optionInfo: {},
    retries: [],
    outcome: { status: 'asked' },
  })),
});

const run = (runId: string, rounds: Round[]) => ({
  runId,
  name: runId,
  model: null,
  inputTokenBudget: 1000,
  isGoalCheckedInCode: false,
  rounds,
});

const state: InspectorState = {
  ...initialState,
  runs: [run('a', [round(1, [1])]), run('b', [round(1, [1, 2]), round(2, [1, 2, 3])])],
};

// Run a grows a turn; run b grows a turn in its newest round.
const grown: InspectorState = {
  ...state,
  runs: [run('a', [round(1, [1, 2])]), run('b', [round(1, [1, 2]), round(2, [1, 2, 3, 4])])],
};

const ids = (selected: ReturnType<typeof resolveSelection>) => [
  selected.run?.runId,
  selected.round?.round,
  selected.turn?.turn,
];

describe('resolveSelection', () => {
  it('follows the newest run, round and turn', () => {
    expect(ids(resolveSelection(state, FOLLOWING))).toEqual(['b', 2, 3]);
  });

  it("keeps a chosen round, and follows that round's newest turn", () => {
    const selected = resolveSelection(state, {
      isFollowing: false,
      choice: { runId: 'b', round: 1 },
    });
    expect(ids(selected)).toEqual(['b', 1, 2]);
  });

  it('falls back to the newest when a choice no longer exists', () => {
    const selected = resolveSelection(state, {
      isFollowing: false,
      choice: { runId: 'gone', round: 9 },
    });
    expect(ids(selected)).toEqual(['b', 2, 3]);
  });

  it('selects nothing before the first run', () => {
    expect(resolveSelection(initialState, FOLLOWING)).toEqual({
      run: undefined,
      round: undefined,
      turn: undefined,
    });
  });
});

describe('selectChoice', () => {
  it('holds a turn that is not the newest, so the page stays put', () => {
    const selection = selectChoice(state, { runId: 'b', round: 1, turn: 1 });
    expect(selection).toEqual({ isFollowing: false, choice: { runId: 'b', round: 1, turn: 1 } });
  });

  it('resumes following when the choice names the newest turn', () => {
    expect(selectChoice(state, { runId: 'b', round: 2, turn: 3 })).toEqual(FOLLOWING);
  });

  it('holds a round header, even when it is the newest round', () => {
    expect(selectChoice(state, { runId: 'b', round: 2 })).toEqual({
      isFollowing: false,
      choice: { runId: 'b', round: 2, turn: 3 },
    });
  });

  it('holds the newest run chosen from the switcher, even though its newest turn is the newest', () => {
    expect(selectChoice(state, { runId: 'b' })).toEqual({
      isFollowing: false,
      choice: { runId: 'b', round: 2, turn: 3 },
    });
  });

  it('holds another run at the turn it resolves to', () => {
    expect(selectChoice(state, { runId: 'a' })).toEqual({
      isFollowing: false,
      choice: { runId: 'a', round: 1, turn: 1 },
    });
  });

  it('keeps a held run still while the run grows', () => {
    const selection = selectChoice(state, { runId: 'a' });
    expect(ids(resolveSelection(grown, selection))).toEqual(['a', 1, 1]);
  });

  it('keeps a held round still while its run grows', () => {
    const selection = selectChoice(state, { runId: 'b', round: 2 });
    expect(ids(resolveSelection(grown, selection))).toEqual(['b', 2, 3]);
  });

  it('moves on to the newest turn as it arrives, once following', () => {
    expect(resolveSelection(grown, FOLLOWING).turn?.turn).toBe(4);
  });

  it('keeps a chosen turn while newer turns arrive', () => {
    const selection = selectChoice(state, { runId: 'b', round: 2, turn: 1 });
    expect(ids(resolveSelection(grown, selection))).toEqual(['b', 2, 1]);
  });
});

describe('selectionIn', () => {
  it('holds a selection in the session it was made in, and follows again in the next one', () => {
    const held: HeldSelection = {
      session: 1,
      selection: { isFollowing: false, choice: { runId: 'r1', round: 2, turn: 1 } },
    };
    expect(selectionIn(held, 1)).toBe(held.selection);
    expect(selectionIn(held, 2)).toEqual(FOLLOWING);
  });
});
