import type { Selected } from '../lib/selection.ts';

/** The selected round: what it picked, its op tree, and the context the task returned. */
export const RoundPanel = ({ selected }: { selected: Selected }) => {
  const { round } = selected;
  return (
    <aside aria-label="Round" className="overflow-auto border-l border-line p-5">
      {round !== undefined && <p className="text-[15px] font-semibold">Round {round.round}</p>}
    </aside>
  );
};
