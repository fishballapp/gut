// The session's record: every run and session event in order, kept for the life of the process so
// a reload or a second tab replays all of it.
import type { InspectorEvent } from '@gut.run/core/inspector';

export type EventLog = ReturnType<typeof createEventLog>;

export const createEventLog = () => {
  const events: InspectorEvent[] = [];
  const listeners = new Set<() => void>();
  return {
    append: (event: InspectorEvent) => {
      events.push(event);
      for (const listener of listeners) listener();
    },
    /** The event at `index`, the SSE id it was sent with. */
    at: (index: number): InspectorEvent | undefined => events[index],
    size: () => events.length,
    /** Calls `listener` after every append; returns the unsubscribe. */
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
