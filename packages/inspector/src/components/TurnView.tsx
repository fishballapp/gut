import { useState } from 'react';
import type { Selected } from '../lib/selection.ts';
import type { OptionSort } from '../lib/sort-options.ts';
import { formatRetry } from '../lib/turn-display.ts';
import type { InspectorState } from '../state/inspector-state.ts';
import { QuestionBlock } from './turn/QuestionBlock.tsx';
import { SortToggle } from './turn/SortToggle.tsx';
import { TurnHeader, TurnStatus } from './turn/TurnHeader.tsx';

/** The selected turn: what was asked and how it was answered, or what waits for an answer. */
export const TurnView = ({ state, selected }: { state: InspectorState; selected: Selected }) => {
  const { run, round, turn } = selected;
  const [sort, setSort] = useState<OptionSort>('as-sent');
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
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <TurnHeader round={round} turn={turn} />
            <div className="flex shrink-0 flex-col items-end gap-2">
              <TurnStatus turn={turn} />
              <SortToggle value={sort} onChange={setSort} />
            </div>
          </div>

          {turn.retries.length > 0 && (
            <ul className="mt-4 space-y-1">
              {turn.retries.map((retry, i) => (
                <li key={`${retry.delayMs}-${i}`} className="font-mono text-xs text-muted">
                  {formatRetry(retry)}
                </li>
              ))}
            </ul>
          )}

          {turn.outcome.status === 'failed' && (
            <p role="alert" className="mt-4 font-mono text-sm text-you">
              {turn.outcome.error}
              {turn.outcome.isTooLarge && (
                <span className="mt-1 block">too large: split and asked again</span>
              )}
            </p>
          )}

          {turn.outcome.status === 'dropped' && (
            <p className="mt-4 font-mono text-sm text-muted">
              {turn.outcome.reason === 'repick'
                ? 'Dropped by a re-pick before it was answered.'
                : 'Dropped: the budget ran out before the model was asked.'}
            </p>
          )}

          {Object.entries(turn.request.questions).map(([questionKey, question]) => (
            <QuestionBlock
              key={`${run?.runId ?? ''}:${round.round}:${turn.turn}:${questionKey}`}
              turn={turn}
              questionKey={questionKey}
              question={question}
              sort={sort}
            />
          ))}
        </div>
      )}
    </main>
  );
};
