import type { Selected } from '../lib/selection.ts';
import type { InspectorState } from '../state/inspector-state.ts';

/** The selected turn: what was asked and how it was answered, or what waits for an answer. */
export const TurnView = ({ state, selected }: { state: InspectorState; selected: Selected }) => {
  const { round, turn } = selected;
  return (
    <main className="relative overflow-auto px-8 py-6">
      {state.incompatible !== undefined && (
        <p role="alert" className="rounded-lg border border-you p-4 text-you">
          This page speaks inspector protocol {state.incompatible.page}, and this gut speaks{' '}
          {state.incompatible.cli}. Build the page from the same gut version as the CLI.
        </p>
      )}
      {state.incompatible === undefined && round === undefined && (
        <div className="grid h-full place-items-center text-center text-muted">
          <p>
            <span className="block text-base font-semibold text-ink">
              Waiting for the first round
            </span>
            Rounds appear here as they happen.
          </p>
        </div>
      )}
      {round !== undefined && turn !== undefined && (
        <p className="font-mono text-xs text-muted">
          round {round.round} · turn {turn.turn}
        </p>
      )}
    </main>
  );
};
