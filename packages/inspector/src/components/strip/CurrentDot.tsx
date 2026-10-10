import { cn } from '@fishballapps/cn';
import type { CurrentState } from '../../lib/current-turn.ts';
import { isAwaitingYou } from '../../lib/current-turn.ts';

/**
 * The static mark under the run's current block, for when the system asks for reduced motion and the
 * block can't pulse: coral when it needs you, ink when the model answers. Otherwise the pulse says it.
 */
export const CurrentDot = ({ state }: { state: CurrentState }) => (
  <span
    aria-hidden
    className={cn(
      'hidden size-1.5 rounded-full motion-reduce:block',
      isAwaitingYou(state) ? 'bg-you' : 'bg-ink',
    )}
  />
);

/** The slot under a block that holds the dot, so a block and an empty round keep the same height. */
export const CurrentSlot = ({ state }: { state: CurrentState | undefined }) => (
  <span className="flex h-2 items-center justify-center">
    {state !== undefined && <CurrentDot state={state} />}
  </span>
);
