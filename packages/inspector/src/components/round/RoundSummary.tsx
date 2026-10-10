import { abandonedPickedSteps, roundSummaryLine } from '../../lib/round-panel.ts';
import type { Round, Run } from '../../state/inspector-state.ts';

export const RoundSummary = ({ round, run }: { round: Round; run: Run | undefined }) => {
  const line = roundSummaryLine(round, run);
  const abandoned = abandonedPickedSteps(round);
  const abandonedCount = round.picks.filter(pick => pick.abandoned !== undefined).length;

  return (
    <header className="space-y-1">
      <h2 className="text-[15px] font-semibold">Round {round.round}</h2>
      {line.kind === 'picked' && (
        <div className="space-y-0.5 text-[13px] leading-snug">
          <p className="break-words font-mono text-ink">{line.step}</p>
          <p className="font-mono text-xs text-muted">
            {line.probabilities.length > 0 ? `${line.probabilities} · ${line.meta}` : line.meta}
          </p>
        </div>
      )}
      {line.kind === 'goal' && <p className="text-[13px] text-muted">{line.text}</p>}
      {line.kind === 'pending' && <p className="text-[13px] text-muted">{line.text}</p>}
      {round.invoked?.error !== undefined && (
        <p className="text-[13px] text-you">{round.invoked.error}</p>
      )}
      {abandonedCount > 0 && (
        <div className="space-y-0.5 pt-1">
          <p className="text-xs text-muted">
            {abandonedCount} {abandonedCount === 1 ? 'pick' : 'picks'} abandoned
          </p>
          {abandoned.map((step, index) => (
            <p key={index} className="truncate font-mono text-xs text-muted line-through">
              {step}
            </p>
          ))}
        </div>
      )}
    </header>
  );
};
