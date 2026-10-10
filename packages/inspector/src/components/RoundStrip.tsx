import type { Select, Selected } from '../lib/selection.ts';

/** The run's rounds at a glance, each a group of its turns. */
export const RoundStrip = ({ selected, select }: { selected: Selected; select: Select }) => {
  const { run, round: current } = selected;
  if (run === undefined || run.rounds.length === 0) return <div className="pb-4" />;
  return (
    <ol aria-label="Rounds at a glance" className="flex gap-3.5 py-4">
      {run.rounds.map(round => (
        <li key={round.round}>
          <button
            type="button"
            aria-current={round.round === current?.round}
            onClick={() => select({ runId: run.runId, round: round.round })}
            className="font-mono text-xs text-muted aria-current:text-ink"
          >
            {round.round}
          </button>
        </li>
      ))}
    </ol>
  );
};
