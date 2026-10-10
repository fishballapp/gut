import type { RunStatus } from '../../lib/run-status.ts';

const dotClass = {
  you: 'bg-you',
  ok: 'bg-ok',
} as const;

/** The run's status: waiting for you, playing, paused, ended, or reconnecting. */
export const StatusPill = ({ status }: { status: RunStatus }) => (
  <span
    role="status"
    aria-live="polite"
    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-0.5 text-[12px] text-ink"
  >
    {status.dot !== undefined && (
      <span aria-hidden className={`size-[7px] rounded-full ${dotClass[status.dot]}`} />
    )}
    {status.label}
  </span>
);
