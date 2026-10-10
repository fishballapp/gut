import type { ConnectionStatus } from '../../lib/connection.ts';
import { type Ending, endingsFor } from '../../lib/endings.ts';
import type { Selected } from '../../lib/selection.ts';
import type { InspectorState } from '../../state/inspector-state.ts';
import { EndingBanner } from './EndingBanner.tsx';

/** How the turn column opens: what ended the run or the task, the connection, or the wait for round 1. */
export const TurnEndings = ({
  state,
  selected,
  status,
}: {
  state: InspectorState;
  selected: Selected;
  status: ConnectionStatus;
}) => {
  const endings: Ending[] = endingsFor(state, selected.run, status);
  const isWaiting = state.incompatible === undefined && selected.round === undefined;
  return (
    <>
      {endings.length > 0 && (
        <div className="mx-auto mb-6 max-w-3xl space-y-3">
          {endings.map(ending => (
            <EndingBanner key={ending.kind} ending={ending} />
          ))}
        </div>
      )}
      {isWaiting && (
        <div className="grid h-full place-items-center text-center text-muted">
          <p>
            <span className="block text-base font-semibold text-ink">
              Waiting for the first round
            </span>
            Rounds appear here as they happen.
          </p>
        </div>
      )}
    </>
  );
};
