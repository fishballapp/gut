import type { Action } from '@gut.run/core/inspector';
import type { ActOutcome, ConnectionStatus } from '../lib/connection.ts';
import { runBudget } from '../lib/run-budget.ts';
import { runStatus } from '../lib/run-status.ts';
import type { Select, Selected } from '../lib/selection.ts';
import type { InspectorState } from '../state/inspector-state.ts';
import { RoundStrip } from './RoundStrip.tsx';
import { BudgetMeter } from './run/BudgetMeter.tsx';
import { FollowToggle } from './run/FollowToggle.tsx';
import { RunControls } from './run/RunControls.tsx';
import { RunSwitcher } from './run/RunSwitcher.tsx';
import { StatusPill } from './run/StatusPill.tsx';

/** The run: its task and name, its goal as the title, its controls, and the strip of its rounds. */
export const RunHeader = ({
  state,
  selected,
  select,
  isFollowing,
  follow,
  status,
  act,
}: {
  state: InspectorState;
  selected: Selected;
  select: Select;
  isFollowing: boolean;
  follow: () => void;
  status: ConnectionStatus;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { run } = selected;
  const goal = run?.rounds.at(-1)?.context.goal;
  const pill = runStatus(state, run, status);
  const isLive = state.ended === undefined;
  return (
    <section aria-label="Run" className="col-span-3 border-b border-line px-5 pt-[18px]">
      <p className="font-mono text-xs text-muted">
        {state.task}
        {state.task !== undefined && run !== undefined && ' · '}
        {run !== undefined &&
          (state.runs.length > 1 ? (
            <RunSwitcher state={state} run={run} status={status} select={select} />
          ) : (
            run.name
          ))}
      </p>
      <div className="mt-0.5 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">Goal</p>
          <h1 className="text-2xl font-semibold tracking-tight">{goal ?? state.task ?? 'gut'}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-1">
          <StatusPill status={pill} />
          {run !== undefined && <BudgetMeter budget={runBudget(run)} />}
          {isLive && <FollowToggle isFollowing={isFollowing} onFollow={follow} />}
          <RunControls state={state} run={run} act={act} />
        </div>
      </div>
      <RoundStrip selected={selected} select={select} pending={state.pending} />
    </section>
  );
};
