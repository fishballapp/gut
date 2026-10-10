import { cn } from '@fishballapps/cn';
import { UserIcon } from '@phosphor-icons/react';
import type { Ref } from 'react';
import type { BlockLook } from '../../lib/strip-block.ts';

const STRIPES_YOU =
  'bg-[repeating-linear-gradient(-45deg,var(--color-you)_0_2px,transparent_2px_6px)]';
const STRIPES_CHOSEN =
  'bg-[repeating-linear-gradient(-45deg,var(--color-chosen)_0_2px,transparent_2px_6px)]';

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
    case 'waiting':
      return STRIPES_YOU;
    case 'in-flight':
      return STRIPES_CHOSEN;
  }
};

/** The selected turn's mark, in highlighter lime. A block that draws its own outline gets a ring outside it, so both show. */
const selectionClass = (look: BlockLook, isSelected: boolean): string | undefined => {
  if (!isSelected) return undefined;
  if (look.kind === 'you' || look.kind === 'dropped' || look.kind === 'failed') {
    return 'ring-2 ring-mark ring-offset-2 ring-offset-ground';
  }
  return 'outline-2 -outline-offset-2 outline-mark';
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
    case 'waiting':
    case 'in-flight':
      return null;
  }
};

/** One turn's block in the round strip: its look, and a button that selects the turn. */
export const TurnBlock = ({
  ref,
  look,
  name,
  isSelected,
  onSelect,
}: {
  ref?: Ref<HTMLButtonElement>;
  look: BlockLook;
  name: string;
  isSelected: boolean;
  onSelect: () => void;
}) => (
  <button
    ref={ref}
    type="button"
    aria-label={name}
    aria-current={isSelected}
    onClick={onSelect}
    className={cn(
      'relative h-9 w-6 shrink-0 overflow-hidden rounded-[5px]',
      lookClass(look),
      selectionClass(look, isSelected),
    )}
  >
    {lookMark(look)}
  </button>
);
