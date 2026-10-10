import type { Select, Selected } from '../lib/selection.ts';

/** Every round of the run, newest last. */
export const RoundList = ({ selected, select }: { selected: Selected; select: Select }) => {
  const { run, round: current } = selected;
  return (
    <nav aria-label="Rounds" className="overflow-auto border-r border-line px-2.5 py-3.5">
      <h2 className="px-2.5 pb-2 text-xs font-semibold text-muted">Rounds</h2>
      <ol>
        {run?.rounds.map(round => (
          <li key={round.round}>
            <button
              type="button"
              aria-current={round.round === current?.round}
              onClick={() => select({ runId: run.runId, round: round.round })}
              className="flex w-full gap-2 rounded-lg px-2.5 py-2 text-left aria-current:bg-raised"
            >
              <span className="font-mono text-xs text-muted tabular-nums">{round.round}</span>
              <span className="truncate font-mono">{round.picked?.step ?? '…'}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
};
