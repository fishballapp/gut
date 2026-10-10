// What the developer is looking at. A part left unset follows the newest: the latest run, its
// latest round, that round's latest turn.
import type { InspectorState, Round, Run, Turn } from '../state/inspector-state.ts';

export type Selection = { runId?: string; round?: number; turn?: number };

export type Selected = { run?: Run; round?: Round; turn?: Turn };

export const resolveSelection = (state: InspectorState, selection: Selection): Selected => {
  const run = state.runs.find(entry => entry.runId === selection.runId) ?? state.runs.at(-1);
  const round = run?.rounds.find(entry => entry.round === selection.round) ?? run?.rounds.at(-1);
  const turn = round?.turns.find(entry => entry.turn === selection.turn) ?? round?.turns.at(-1);
  return { run, round, turn };
};

/** Changes what is selected; each region calls it with the part it names. */
export type Select = (selection: Selection) => void;
