import { cn } from '@fishballapps/cn';
import type { RefObject } from 'react';
import { currentTurnOf, roundCurrentState } from '../../lib/current-turn.ts';
import type { Select } from '../../lib/selection.ts';
import { blockLook, blockName, isRoundWaiting } from '../../lib/strip-block.ts';
import type { Decision, Round, Run } from '../../state/inspector-state.ts';
import { CurrentSlot } from './CurrentDot.tsx';
import { TurnBlock } from './TurnBlock.tsx';

/**
 * One round in the strip: an outlined box of its turns' blocks, labelled by its number. The box has
 * the same height empty or not, so every label sits on one baseline. A round whose pick needed no
 * turn and waits to run is an empty box that pulses and carries the dot.
 */
export const RoundGroup = ({
  run,
  round,
  isSelected,
  selectedTurn,
  selectedBlockRef,
  pending,
  select,
}: {
  run: Run;
  round: Round;
  isSelected: boolean;
  selectedTurn: number | undefined;
  selectedBlockRef: RefObject<HTMLButtonElement | null>;
  pending: readonly Decision[];
  select: Select;
}) => {
  const isWaiting = isRoundWaiting(run.runId, round.round, pending);
  const current = currentTurnOf(round, run.runId, pending);
  const roundState = roundCurrentState(round, run.runId, pending);
  const emptyState = round.turns.length === 0 ? roundState : undefined;
  return (
    <li className="flex flex-col items-center gap-1.5">
      <fieldset
        aria-label={
          emptyState === undefined ? `round ${round.round}` : `round ${round.round}: waiting to run`
        }
        className={cn(
          'flex h-14 min-w-9 items-start gap-1 rounded-lg p-1.5 outline outline-1',
          isSelected ? 'outline-faint' : 'outline-line',
          emptyState !== undefined && 'motion-safe:animate-pulse',
        )}
      >
        {round.turns.map(turn => {
          const look = blockLook(turn);
          const turnState = current?.turn === turn.turn ? current.state : undefined;
          const isSelectedTurn = isSelected && turn.turn === selectedTurn;
          return (
            <TurnBlock
              key={turn.turn}
              ref={isSelectedTurn ? selectedBlockRef : undefined}
              look={look}
              name={blockName(round.round, turn.turn, look, turnState)}
              current={turnState}
              isSelected={isSelectedTurn}
              onSelect={() => select({ runId: run.runId, round: round.round, turn: turn.turn })}
            />
          );
        })}
        {emptyState !== undefined && (
          <span className="flex w-6 flex-col items-center">
            <span className="h-9" />
            <CurrentSlot state={emptyState} />
          </span>
        )}
      </fieldset>
      <button
        type="button"
        aria-current={isSelected}
        aria-label={`round ${round.round}`}
        onClick={() => select({ runId: run.runId, round: round.round })}
        className={cn(
          'font-mono text-xs tabular-nums',
          isWaiting && 'text-you',
          !isWaiting && (isSelected ? 'text-ink' : 'text-muted'),
        )}
      >
        {round.round}
      </button>
    </li>
  );
};
