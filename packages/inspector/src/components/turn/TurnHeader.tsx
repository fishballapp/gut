import { cn } from '@fishballapps/cn';
import { turnStatusLabel } from '../../lib/turn-display.ts';
import type { Round, Turn } from '../../state/inspector-state.ts';

/** Who answered and what it cost, for the top-right of the turn; nothing while it waits for you. */
export const TurnStatus = ({ turn }: { turn: Turn }) => {
  const isWaiting = turn.outcome.status === 'asked' && turn.suggestion === undefined;
  if (isWaiting) return null;
  return (
    <p
      className={cn(
        'font-mono text-xs tabular-nums',
        turn.outcome.status === 'failed' ? 'text-you' : 'text-muted',
      )}
    >
      {turnStatusLabel(turn)}
    </p>
  );
};

/** Eyebrow for the selected turn: which round and turn, and whether it waits for you. */
export const TurnHeader = ({
  round,
  turn,
  isAwaitingYou,
}: {
  round: Round;
  turn: Turn;
  isAwaitingYou: boolean;
}) => {
  return (
    <p className="font-mono text-xs whitespace-nowrap text-muted">
      round {round.round} · turn {turn.turn}
      {turn.edits.length > 0 && <span className="text-muted"> · with edits</span>}
      {isAwaitingYou && <span className="text-you"> · waiting for you</span>}
    </p>
  );
};
