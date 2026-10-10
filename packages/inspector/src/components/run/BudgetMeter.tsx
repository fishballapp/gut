import { Meter } from '@base-ui/react/meter';
import { formatBudgetLabel, type RunBudget } from '../../lib/run-budget.ts';

/** Model-spent input tokens against the run's budget, with the sketch's mono label. */
export const BudgetMeter = ({ budget }: { budget: RunBudget }) => {
  const label = formatBudgetLabel(budget);
  return (
    <div className="flex items-center gap-2.5">
      <Meter.Root
        value={budget.inputTokens}
        min={0}
        max={Math.max(budget.budget, 1)}
        aria-label="Input token budget"
        aria-valuetext={label}
        className="w-[88px]"
      >
        <Meter.Track className="h-[3px] overflow-hidden rounded-full bg-track">
          <Meter.Indicator className="h-full bg-ink" />
        </Meter.Track>
      </Meter.Root>
      <span className="font-mono text-[11px] text-muted tabular-nums">{label}</span>
    </div>
  );
};
