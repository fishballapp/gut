import { useState } from 'react';
import { AppBar } from './components/AppBar.tsx';
import { GutBackground } from './components/GutBackground.tsx';
import { RoundList } from './components/RoundList.tsx';
import { RoundPanel } from './components/RoundPanel.tsx';
import { RunHeader } from './components/RunHeader.tsx';
import { TurnView } from './components/TurnView.tsx';
import { act, useInspector } from './lib/connection.ts';
import { resolveSelection, type Selection } from './lib/selection.ts';

/**
 * The page, by level: gut's bar; the run (its goal, controls and the strip of its rounds); then
 * the rounds, the selected turn, and the selected round. Each region is its own component.
 */
export const App = () => {
  const { state, status } = useInspector();
  const [selection, setSelection] = useState<Selection>({});
  const selected = resolveSelection(state, selection);
  return (
    <div className="relative isolate grid h-full grid-cols-[264px_1fr_400px] grid-rows-[auto_auto_1fr]">
      <GutBackground />
      <AppBar model={selected.run?.model ?? state.pageModel} />
      <RunHeader
        state={state}
        selected={selected}
        select={setSelection}
        status={status}
        act={act}
      />
      <RoundList selected={selected} select={setSelection} pending={state.pending} />
      <TurnView state={state} selected={selected} />
      <RoundPanel selected={selected} />
    </div>
  );
};
