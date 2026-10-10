// The session's record: every run and session event in order, kept until a restart clears it, so a
// reload or a second tab replays all of it.
import type { InspectorEvent } from '@gut.run/core/inspector';

export type EventLog = ReturnType<typeof createEventLog>;

export const createEventLog = () => {
  const events: InspectorEvent[] = [];
  /** The id of `events[0]`: ids keep counting up through a clear, so a Last-Event-ID stays valid. */
  let firstId = 0;
  const listeners = new Set<() => void>();
  return {
    append: (event: InspectorEvent) => {
      events.push(event);
      for (const listener of listeners) listener();
    },
    /** The lowest id still kept: a client behind it resumes here. */
    firstId: () => firstId,
    /** The event with this id, the SSE id it was sent with. */
    at: (id: number): InspectorEvent | undefined => events[id - firstId],
    /** Forgets every event; the next one gets the id after the last. */
    clear: () => {
      firstId += events.length;
      events.length = 0;
    },
    /** Calls `listener` after every append; returns the unsubscribe. */
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
