import type { Selected } from '../lib/selection.ts';
import { ContextTree } from './round/ContextTree.tsx';
import { OpTree } from './round/OpTree.tsx';
import { RoundSummary } from './round/RoundSummary.tsx';

/** The selected round: what it picked, its op tree, and the context the task returned. */
export const RoundPanel = ({ selected }: { selected: Selected }) => {
  const { run, round } = selected;
  return (
    <aside
      aria-label="Round"
      className="overflow-auto border-t border-line p-5 lg:border-t-0 lg:border-l"
    >
      {round !== undefined && (
        <div key={round.round} className="flex min-w-0 flex-col gap-6">
          <RoundSummary round={round} run={run} />
          <OpTree ops={round.ops} pickedAddress={round.picked?.address} />
          <ContextTree context={round.context} />
        </div>
      )}
    </aside>
  );
};
