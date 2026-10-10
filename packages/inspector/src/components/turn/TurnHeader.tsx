import { cn } from '@fishballapps/cn';
import { turnStatusLabel } from '../../lib/turn-display.ts';
import type { Round, Turn } from '../../state/inspector-state.ts';

/** Who answered and what it cost, for the top-right of the turn. A turn waiting for you has no tokens yet. */
export const TurnStatus = ({ turn, isAwaitingYou }: { turn: Turn; isAwaitingYou: boolean }) => {
  if (isAwaitingYou) {
    return <p className="font-mono text-xs tabular-nums text-muted">no tokens yet</p>;
  }
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
      {isAwaitingYou && <span className="text-you"> · waiting for you</span>}
    </p>
  );
};
