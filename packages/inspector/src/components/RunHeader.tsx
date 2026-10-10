import type { ConnectionStatus } from '../lib/connection.ts';
import type { Select, Selected } from '../lib/selection.ts';
import type { InspectorState } from '../state/inspector-state.ts';
import { RoundStrip } from './RoundStrip.tsx';

/** The run: its task and name, its goal as the title, its controls, and the strip of its rounds. */
export const RunHeader = ({
  state,
  selected,
  select,
  status,
}: {
  state: InspectorState;
  selected: Selected;
  select: Select;
  status: ConnectionStatus;
}) => {
  const { run } = selected;
  const goal = run?.rounds.at(-1)?.context.goal;
  return (
    <section aria-label="Run" className="col-span-3 border-b border-line px-5 pt-[18px]">
      <p className="font-mono text-xs text-muted">
        {[state.task, run?.name].filter(Boolean).join(' · ')}
        {status === 'lost' && ' · reconnecting…'}
      </p>
      <p className="mt-0.5 text-xs font-medium text-muted">Goal</p>
      <h1 className="text-2xl font-semibold tracking-tight">{goal ?? state.task ?? 'gut'}</h1>
      <RoundStrip selected={selected} select={select} />
    </section>
  );
};
