import { cn } from '@fishballapps/cn';

/** The run's current turn in the sidebar: a dot that pulses, coral when it needs you. */
export const CurrentMarker = ({ isAwaitingYou }: { isAwaitingYou: boolean }) => (
  <span
    role="img"
    aria-label={isAwaitingYou ? 'current, waiting for you' : 'current, in flight'}
    className={cn(
      'size-2 shrink-0 rounded-full motion-safe:animate-pulse',
      isAwaitingYou ? 'bg-you' : 'bg-ink',
    )}
  />
);
