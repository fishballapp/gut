import { cn } from '@fishballapps/cn';
import { isAbandonedPick, turnStatusLabel } from '../../lib/turn-display.ts';
import type { Round, Turn } from '../../state/inspector-state.ts';

/** Who answered and what it cost, for the top-right of the turn. */
export const TurnStatus = ({ turn }: { turn: Turn }) => {
  const status = turnStatusLabel(turn);
  const isWaiting = turn.outcome.status === 'asked';
  const isFailed = turn.outcome.status === 'failed';
  return (
    <p
      className={cn(
        'font-mono text-xs tabular-nums',
        isWaiting || isFailed ? 'text-you' : 'text-muted',
      )}
    >
      {status}
    </p>
  );
};

/** Eyebrow for the selected turn: which round and turn. */
export const TurnHeader = ({ round, turn }: { round: Round; turn: Turn }) => {
  const abandoned = isAbandonedPick(round, turn);
  return (
    <p className="font-mono text-xs text-muted">
      round {round.round} · turn {turn.turn}
      {abandoned && ' · abandoned pick'}
    </p>
  );
};
