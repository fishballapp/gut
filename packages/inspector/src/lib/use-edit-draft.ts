// The draft of the selected round's edits, held while the developer makes them. A draft belongs to
// its round, not to one pick: a re-pick of the round (the slider, Ask model) keeps it, and only a
// Pick again that sends it, or Discard, clears it. Editing is open only while a decision waits.
import { useState } from 'react';
import type { Decision, Round, Run } from '../state/inspector-state.ts';
import { type EditDraft, startDraft } from './edit-draft.ts';
import type { Selected } from './selection.ts';

export type Editing = { runId: string; round: number; draft: EditDraft };

/** The draft held for this run's round, if any. */
export const draftIn = (
  editing: Editing | undefined,
  run: Run | undefined,
  round: Round | undefined,
): EditDraft | undefined =>
  editing !== undefined &&
  run !== undefined &&
  round !== undefined &&
  editing.runId === run.runId &&
  editing.round === round.round
    ? editing.draft
    : undefined;

/** The decision waiting for the selected round, a turn to answer or a step to run. */
const waitingDecisionOf = (
  pending: readonly Decision[],
  run: Run | undefined,
  round: Round | undefined,
): Decision | undefined =>
  run === undefined || round === undefined
    ? undefined
    : pending.find(decision => decision.runId === run.runId && decision.round === round.round);

export const useEditDraft = (selected: Selected, pending: readonly Decision[]) => {
  const [editing, setEditing] = useState<Editing>();
  const { run, round } = selected;
  const decision = waitingDecisionOf(pending, run, round);
  return {
    /** The decision the edits would be picked again at; undefined when no decision waits. */
    decision,
    /** The draft in progress, shown only while a decision waits for its round. */
    draft: decision !== undefined ? draftIn(editing, run, round) : undefined,
    start: () => {
      if (run === undefined || round === undefined) return;
      setEditing({ runId: run.runId, round: round.round, draft: startDraft(round) });
    },
    change: (draft: EditDraft) =>
      setEditing(current => (current === undefined ? current : { ...current, draft })),
    stop: () => setEditing(undefined),
  };
};

export type RoundEdit = ReturnType<typeof useEditDraft>;
