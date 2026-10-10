import { cn } from '@fishballapps/cn';
import { CheckIcon } from '@phosphor-icons/react';
import { formatProbability } from '../../lib/format.ts';

/** Split so only the first line of a chosen option gets the highlight mark. */
const splitFirstLine = (text: string): { first: string; rest: string | undefined } => {
  const newline = text.indexOf('\n');
  if (newline === -1) return { first: text, rest: undefined };
  return { first: text.slice(0, newline), rest: text.slice(newline + 1) };
};

/**
 * One option of a question. Ticket 5 extends this into a choosable control; keep the row's props
 * and layout stable for that.
 */
export const OptionRow = ({
  optionKey,
  text,
  kindLabel,
  probability,
  isChosen,
  isAnsweredByYou,
  showsProbability,
}: {
  optionKey: string;
  text: string;
  kindLabel?: string;
  probability: number;
  isChosen: boolean;
  isAnsweredByYou: boolean;
  showsProbability: boolean;
}) => {
  const { first, rest } = splitFirstLine(text);
  return (
    <li className="py-1.5">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-baseline gap-x-2">
        <span className="flex items-baseline gap-0.5 font-mono text-[11px] text-muted tabular-nums">
          {isChosen && <CheckIcon aria-hidden size={12} className="shrink-0 text-chosen" />}
          {optionKey}
        </span>
        <div className="min-w-0 font-mono text-[13px] leading-snug">
          <p className="whitespace-pre-wrap">
            {isChosen ? (
              <span className="bg-highlight px-0.5 text-on-highlight">{first}</span>
            ) : (
              <span className="text-ink">{first}</span>
            )}
            {kindLabel !== undefined && (
              <span className="ml-2 font-sans text-[11px] text-muted">{kindLabel}</span>
            )}
            {isAnsweredByYou && isChosen && (
              <span className="ml-2 rounded-[3px] bg-ink px-1.5 py-px font-sans text-[11px] font-medium leading-4 text-ground">
                you
              </span>
            )}
            {isChosen && <span className="sr-only">chosen</span>}
            {rest !== undefined && <span className="text-ink">{`\n${rest}`}</span>}
          </p>
          {showsProbability && (
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-track">
              <div
                className={cn('h-full rounded-full', isChosen ? 'bg-chosen' : 'bg-bar')}
                style={{ width: `${Math.min(probability, 1) * 100}%` }}
              />
            </div>
          )}
        </div>
        {showsProbability && (
          <span
            className={cn(
              'shrink-0 font-mono text-[13px] tabular-nums',
              isChosen ? 'text-chosen' : 'text-muted',
            )}
          >
            {formatProbability(probability)}
          </span>
        )}
      </div>
    </li>
  );
};
