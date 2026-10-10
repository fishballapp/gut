// What the developer is looking at. While following, the newest run's newest turn is selected, and
// moves as the run goes on. A choice holds the turn it resolved to when it was made, until the
// developer picks the newest turn (which resumes following) or follows again. A part of a choice left
// unset resolves to the newest when it is made: the latest run, its latest round, that round's latest turn.
import type { InspectorState, Round, Run, Turn } from '../state/inspector-state.ts';

/** What a region names when it selects something. */
export type Choice = { runId?: string; round?: number; turn?: number };

export type Selection = { isFollowing: true } | { isFollowing: false; choice: Choice };

export type Selected = { run?: Run; round?: Round; turn?: Turn };

export const FOLLOWING: Selection = { isFollowing: true };

/** A selection the page holds, with the session it was made in. */
export type HeldSelection = { session: number; selection: Selection };

/** The selection in force in `session`: one held from an earlier session has lapsed, so it follows. */
export const selectionIn = (held: HeldSelection, session: number): Selection =>
  held.session === session ? held.selection : FOLLOWING;

export const resolveSelection = (state: InspectorState, selection: Selection): Selected => {
  const choice = selection.isFollowing ? {} : selection.choice;
  const run = state.runs.find(entry => entry.runId === choice.runId) ?? state.runs.at(-1);
  const round = run?.rounds.find(entry => entry.round === choice.round) ?? run?.rounds.at(-1);
  const turn = round?.turns.find(entry => entry.turn === choice.turn) ?? round?.turns.at(-1);
  return { run, round, turn };
};

/**
 * The selection a choice makes. Only a choice that names a turn, and lands on the newest one, resumes
 * following. Any other choice holds the run, round and turn it resolves to now, so the page stays put.
 */
export const selectChoice = (state: InspectorState, choice: Choice): Selection => {
  const newest = resolveSelection(state, FOLLOWING);
  const chosen = resolveSelection(state, { isFollowing: false, choice });
  const isNewest =
    choice.turn !== undefined &&
    chosen.run?.runId === newest.run?.runId &&
    chosen.round?.round === newest.round?.round &&
    chosen.turn?.turn === newest.turn?.turn;
  if (isNewest) return FOLLOWING;
  return {
    isFollowing: false,
    choice: {
      ...(chosen.run === undefined ? {} : { runId: chosen.run.runId }),
      ...(chosen.round === undefined ? {} : { round: chosen.round.round }),
      ...(chosen.turn === undefined ? {} : { turn: chosen.turn.turn }),
    },
  };
};

/** Changes what is selected; each region calls it with the part it names. */
export type Select = (choice: Choice) => void;
