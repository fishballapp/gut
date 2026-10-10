import { cn } from '@fishballapps/cn';
import type { Ref } from 'react';
import { type TurnMark, turnSummary } from '../../lib/turn-summary.ts';
import type { Turn } from '../../state/inspector-state.ts';
import { CurrentMarker } from './CurrentMarker.tsx';

/** One turn under the selected round: what it asked, and its right-hand mark. The selected one sits on the highlighter. */
export const TurnRow = ({
  turn,
  mark,
  isSelected,
  ref,
  onSelect,
}: {
  turn: Turn;
  mark: TurnMark;
  isSelected: boolean;
  ref?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}) => (
  <button
    ref={ref}
    type="button"
    aria-current={isSelected}
    onClick={onSelect}
    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 py-1 ps-7 pe-2.5 text-left text-[13px] text-ink outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-ink"
  >
    <span
      className={cn(
        'min-w-0 truncate rounded px-1 -mx-1',
        isSelected && 'bg-highlight text-on-highlight',
      )}
    >
      {`turn ${turn.turn} · ${turnSummary(turn)}`}
    </span>
    <span className="flex items-center font-mono text-xs text-muted tabular-nums">
      {mark.kind === 'current' ? <CurrentMarker isAwaitingYou={mark.isAwaitingYou} /> : mark.text}
    </span>
  </button>
);
