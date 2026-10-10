import { cn } from '@fishballapps/cn';
import { UserIcon } from '@phosphor-icons/react';
import type { Ref } from 'react';
import type { CurrentState } from '../../lib/current-turn.ts';
import type { BlockLook } from '../../lib/strip-block.ts';
import { CurrentSlot } from './CurrentDot.tsx';

const lookClass = (look: BlockLook): string => {
  switch (look.kind) {
    case 'model':
      return 'bg-track';
    case 'you':
      return 'outline-[1.5px] -outline-offset-[1.5px] outline-ink';
    case 'dropped':
      return 'outline outline-1 -outline-offset-px outline-dashed outline-faint';
    case 'failed':
      return 'outline-[1.5px] -outline-offset-[1.5px] outline-you';
    case 'unanswered':
      return 'outline outline-1 -outline-offset-px outline-faint';
  }
};

/** The mark inside a block: a probability fill from the bottom, a person, or a cross. */
const lookMark = (look: BlockLook) => {
  switch (look.kind) {
    case 'model':
      return (
        <span
          aria-hidden
          style={{ height: `${look.probability * 100}%` }}
          className="absolute inset-x-0 bottom-0 bg-block"
        />
      );
    case 'you':
      return (
        <UserIcon
          aria-hidden
          size={12}
          className="absolute top-1/2 left-1/2 -translate-1/2 text-ink"
        />
      );
    case 'failed':
      return (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center font-mono text-xs leading-none text-you"
        >
          ×
        </span>
      );
    case 'dropped':
    case 'unanswered':
      return null;
  }
};

/**
 * One turn's block in the round strip, with the slot under it: a button that selects the turn. The
 * selected turn is ringed outside the block. The run's current turn carries a dot, and pulses.
 */
export const TurnBlock = ({
  ref,
  look,
  name,
  current,
  isSelected,
  onSelect,
}: {
  ref?: Ref<HTMLButtonElement>;
  look: BlockLook;
  name: string;
  current: CurrentState | undefined;
  isSelected: boolean;
  onSelect: () => void;
}) => (
  <span className="flex w-6 flex-col items-center">
    <button
      ref={ref}
      type="button"
      aria-label={name}
      aria-current={isSelected}
      onClick={onSelect}
      className={cn(
        'relative h-9 w-6 shrink-0 overflow-hidden rounded-[5px]',
        lookClass(look),
        isSelected && 'ring-2 ring-mark ring-offset-2 ring-offset-ground',
        current !== undefined && 'motion-safe:animate-pulse',
      )}
    >
      {lookMark(look)}
    </button>
    <CurrentSlot state={current} />
  </span>
);
