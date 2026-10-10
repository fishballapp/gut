import { Menu } from '@base-ui/react/menu';
import { CaretDownIcon } from '@phosphor-icons/react';
import type { ConnectionStatus } from '../../lib/connection.ts';
import { runStatus } from '../../lib/run-status.ts';
import type { Select } from '../../lib/selection.ts';
import type { InspectorState, Run } from '../../state/inspector-state.ts';

/**
 * The run's name, as a menu of every run the task started, each with its status. Choosing one
 * selects that run's newest round and turn.
 */
export const RunSwitcher = ({
  state,
  run,
  status,
  select,
}: {
  state: InspectorState;
  run: Run;
  status: ConnectionStatus;
  select: Select;
}) => (
  <Menu.Root>
    <Menu.Trigger className="inline-flex items-center gap-1 rounded-sm text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-mark">
      {run.name}
      <CaretDownIcon aria-hidden size={10} />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner sideOffset={6} align="start">
        <Menu.Popup className="min-w-72 rounded-lg border border-line bg-raised p-1 font-sans text-[13px] text-ink shadow-sm outline-none">
          <Menu.RadioGroup value={run.runId} onValueChange={(runId: string) => select({ runId })}>
            {state.runs.map(entry => (
              <Menu.RadioItem
                key={entry.runId}
                value={entry.runId}
                className="flex cursor-default items-baseline justify-between gap-6 rounded-md px-2.5 py-1.5 outline-none data-[highlighted]:bg-track data-[checked]:font-semibold"
              >
                <span className="min-w-0 truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {runStatus(state, entry, status).label}
                </span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);
