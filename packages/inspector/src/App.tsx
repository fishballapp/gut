import { useState } from 'react';
import { AppBar } from './components/AppBar.tsx';
import { GutBackground } from './components/GutBackground.tsx';
import { RoundList } from './components/RoundList.tsx';
import { RoundPanel } from './components/RoundPanel.tsx';
import { RunHeader } from './components/RunHeader.tsx';
import { TurnView } from './components/TurnView.tsx';
import { act, useInspector } from './lib/connection.ts';
import {
  FOLLOWING,
  type HeldSelection,
  resolveSelection,
  type Select,
  type Selection,
  selectChoice,
  selectionIn,
} from './lib/selection.ts';
import { useEditDraft } from './lib/use-edit-draft.ts';

/**
 * The page, by level: gut's bar; the run (its goal, controls and the strip of its rounds); then
 * the rounds, the selected turn, and the selected round. Each region is its own component.
 */
export const App = () => {
  const { state, status } = useInspector();
  // A selection belongs to the session it was made in: a restart begins the record afresh, so the
  // page follows again rather than holding a round or turn whose numbers the new run reuses.
  const [held, setHeld] = useState<HeldSelection>({
    session: state.sessionNumber,
    selection: FOLLOWING,
  });
  const selection = selectionIn(held, state.sessionNumber);
  const setSelectionState = (next: Selection) =>
    setHeld({ session: state.sessionNumber, selection: next });
  const selected = resolveSelection(state, selection);
  const edit = useEditDraft(selected, state.pending);
  const setSelection: Select = choice => setSelectionState(selectChoice(state, choice));
  return (
    <div className="relative isolate grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-[220px_1fr_340px] xl:grid-cols-[264px_1fr_400px] lg:grid-rows-[auto_auto_1fr]">
      <GutBackground />
      <AppBar runModel={selected.run?.model ?? null} pageModel={state.pageModel} act={act} />
      <RunHeader
        state={state}
        selected={selected}
        select={setSelection}
        isFollowing={selection.isFollowing}
        follow={() => setSelectionState(FOLLOWING)}
        status={status}
        act={act}
      />
      <RoundList selected={selected} select={setSelection} pending={state.pending} />
      <TurnView
        state={state}
        selected={selected}
        status={status}
        isEditing={edit.draft !== undefined}
        act={act}
      />
      <RoundPanel selected={selected} edit={edit} act={act} />
    </div>
  );
};
