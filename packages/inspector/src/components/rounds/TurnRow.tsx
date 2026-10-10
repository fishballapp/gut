import { cn } from '@fishballapps/cn';
import type { Ref } from 'react';
import { type TurnMark, turnSummary } from '../../lib/turn-summary.ts';
import type { Turn } from '../../state/inspector-state.ts';

/** One turn under the selected round: what it asked, and its right-hand mark. The selected one sits on the highlighter. */
export const TurnRow = ({
  turn,
  mark,
  isAbandoned,
  isSelected,
  ref,
  onSelect,
}: {
  turn: Turn;
  mark: TurnMark;
  isAbandoned: boolean;
  isSelected: boolean;
  ref?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}) => (
  <button
    ref={ref}
    type="button"
    aria-current={isSelected}
    onClick={onSelect}
    className={cn(
      'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1 ps-7 pe-2.5 text-left text-[13px] outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-ink',
      isAbandoned ? 'text-muted' : 'text-ink',
    )}
  >
    <span
      className={cn(
        'min-w-0 truncate rounded px-1 -mx-1',
        isSelected && 'bg-highlight text-on-highlight',
      )}
    >
      {`turn ${turn.turn} · ${turnSummary(turn)}`}
    </span>
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        mark.isAwaitingYou ? 'font-semibold text-you' : 'text-muted',
      )}
    >
      {mark.text}
    </span>
  </button>
);
