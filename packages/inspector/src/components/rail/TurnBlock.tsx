import { Tooltip } from '@base-ui/react/tooltip';
import { cn } from '@fishballapps/cn';
import { UserIcon } from '@phosphor-icons/react';
import type { ReactNode, Ref } from 'react';
import { type CurrentState, isAwaitingYou } from '../../lib/current-turn.ts';
import type { BlockLook } from '../../lib/turn-block.ts';

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

/** The mark inside a block: a probability fill from the left, a person, or a cross. */
const lookMark = (look: BlockLook) => {
  switch (look.kind) {
    case 'model':
      return (
        <span
          aria-hidden
          style={{ width: `${look.probability * 100}%` }}
          className="absolute inset-y-0 left-0 bg-block"
        />
      );
    case 'you':
      return (
        <UserIcon
          aria-hidden
          size={11}
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
 * The mark of the run's current turn when the system asks for reduced motion and the block can't
 * pulse: a dot in the block, coral when it needs you.
 */
export const CurrentDot = ({ state }: { state: CurrentState }) => (
  <span
    aria-hidden
    className={cn(
      'absolute top-1/2 left-1/2 hidden size-1.5 -translate-1/2 rounded-full motion-reduce:block',
      isAwaitingYou(state) ? 'bg-you' : 'bg-ink',
    )}
  />
);

/**
 * One turn's bar in the rail, as wide as the rail: a button that selects the turn, with what it asked on hover. The
 * selected turn is ringed outside its block; the run's current turn pulses.
 */
export const TurnBlock = ({
  ref,
  look,
  name,
  current,
  isSelected,
  tip,
  onSelect,
}: {
  ref?: Ref<HTMLButtonElement>;
  look: BlockLook;
  name: string;
  current: CurrentState | undefined;
  isSelected: boolean;
  tip: ReactNode;
  onSelect: () => void;
}) => (
  <Tooltip.Root>
    <Tooltip.Trigger
      render={
        <button
          ref={ref}
          type="button"
          aria-label={name}
          aria-current={isSelected}
          data-rail-selected={isSelected || undefined}
          onClick={onSelect}
          className={cn(
            'relative h-4 w-full overflow-hidden rounded-[4px] focus-visible:ring-2 focus-visible:ring-ink',
            lookClass(look),
            isSelected && 'ring-2 ring-mark ring-offset-2 ring-offset-raised',
            current !== undefined && 'motion-safe:animate-pulse',
          )}
        />
      }
    >
      {lookMark(look)}
      {current !== undefined && <CurrentDot state={current} />}
    </Tooltip.Trigger>
    {tip}
  </Tooltip.Root>
);
