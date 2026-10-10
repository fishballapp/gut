import { cn } from '@fishballapps/cn';
import type { ReactNode } from 'react';
import type { Ending } from '../../lib/endings.ts';
import { formatTokens } from '../../lib/format.ts';

const dotClass = {
  you: 'bg-you',
  ok: 'bg-ok',
  faint: 'bg-faint',
} as const;

/** A quiet card: a dot for its tone, a bold lead and muted rest. */
const EndingCard = ({
  tone,
  role,
  isSlim = false,
  children,
}: {
  tone: keyof typeof dotClass;
  role?: 'alert' | 'status';
  isSlim?: boolean;
  children: ReactNode;
}) => (
  <div
    role={role}
    className={cn(
      'flex items-start gap-3 rounded-[10px] border border-line bg-raised px-4',
      isSlim ? 'py-2' : 'py-3',
    )}
  >
    <span aria-hidden className={cn('mt-[7px] size-2.5 shrink-0 rounded-full', dotClass[tone])} />
    <div className="min-w-0 text-sm leading-relaxed">{children}</div>
  </div>
);

const count = (n: number, noun: string) =>
  `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** `1, 3 and 5`. */
const listRounds = (rounds: number[]) => {
  if (rounds.length <= 1) return rounds.join('');
  return `${rounds.slice(0, -1).join(', ')} and ${rounds.at(-1)}`;
};

/** One ending of the selected run, or of the task and the connection, as its banner. */
export const EndingBanner = ({ ending }: { ending: Ending }) => {
  switch (ending.kind) {
    case 'reconnecting':
      return (
        <EndingCard tone="faint" role="status" isSlim>
          <p>
            <span className="font-semibold">Reconnecting to gut…</span>{' '}
            <span className="text-muted">
              Nothing is lost: the stream resumes where it stopped.
            </span>
          </p>
        </EndingCard>
      );

    case 'achieved':
      return (
        <EndingCard tone="ok">
          <p className="font-semibold">Achieved in {count(ending.rounds, 'round')}</p>
          <p className="text-muted">
            {formatTokens(ending.usage.inputTokens)} input tokens in{' '}
            {count(ending.usage.requests, 'request')}
          </p>
        </EndingCard>
      );

    case 'stalled':
      return (
        <EndingCard tone="you">
          <p>
            <span className="font-semibold">Halted: stalled.</span>
            {ending.step !== undefined && (
              <>
                {' '}
                <span className="text-muted">The same pick on the same page three times:</span>{' '}
                <code className="font-mono text-[13px]">{ending.step}</code>{' '}
                <span className="text-muted">from rounds {listRounds(ending.rounds)}.</span>
              </>
            )}
          </p>
        </EndingCard>
      );

    case 'budget':
      return (
        <EndingCard tone="you">
          <p>
            <span className="font-semibold">Halted: the budget ran out.</span>{' '}
            <span className="text-muted">
              {formatTokens(ending.usage.inputTokens)} of {formatTokens(ending.inputTokenBudget)}{' '}
              input tokens in {count(ending.usage.requests, 'request')}
            </span>
          </p>
        </EndingCard>
      );

    case 'error':
      return (
        <EndingCard tone="you">
          <p className="font-semibold">Halted: error.</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[13px] text-muted">
            {ending.error}
          </p>
        </EndingCard>
      );

    case 'nothingToPick':
      return (
        <EndingCard tone="you">
          <p className="font-semibold">
            Halted: nothing left to pick
            {ending.round === undefined ? '.' : ` on round ${ending.round}.`}
          </p>
        </EndingCard>
      );

    case 'threw':
      return (
        <EndingCard tone="you" role="alert">
          <p className="font-semibold">The task threw:</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[13px] text-muted">
            {ending.error}
          </p>
        </EndingCard>
      );

    case 'noRun':
      return (
        <EndingCard tone="you">
          <p>
            <span className="font-semibold">No run attached:</span>{' '}
            <span className="text-muted">
              the task never called runTask, or its @gut.run/core predates the inspector.
            </span>
          </p>
        </EndingCard>
      );

    case 'ended':
      return (
        <p className="px-1 text-sm text-muted">
          The task ended; the record stays until you stop gut (Ctrl-C).
        </p>
      );
  }
};
