import { cn } from '@fishballapps/cn';
import type { RefObject } from 'react';
import type { Select } from '../../lib/selection.ts';
import { blockLook, blockName, isRoundWaiting, isStepWaiting } from '../../lib/strip-block.ts';
import type { Decision, Round, Run } from '../../state/inspector-state.ts';
import { TurnBlock } from './TurnBlock.tsx';

/** One round in the strip: an outlined group of its turns' blocks, labelled by its number. */
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
  return (
    <li className="flex flex-col items-center gap-1.5">
      <div
        className={cn(
          'flex items-end gap-1 rounded-lg p-1.5',
          isSelected && 'outline outline-1 outline-line',
        )}
      >
        {round.turns.map(turn => {
          const look = blockLook({ runId: run.runId, round: round.round, turn, pending });
          const isSelectedTurn = isSelected && turn.turn === selectedTurn;
          return (
            <TurnBlock
              key={turn.turn}
              ref={isSelectedTurn ? selectedBlockRef : undefined}
              look={look}
              name={blockName(round.round, turn.turn, look)}
              isSelected={isSelectedTurn}
              onSelect={() => select({ runId: run.runId, round: round.round, turn: turn.turn })}
            />
          );
        })}
        {isStepWaiting(run.runId, round.round, pending) && (
          <span
            role="img"
            aria-label="picked, not run yet"
            className="size-2.5 shrink-0 self-center rounded-full outline outline-[1.5px] -outline-offset-[1.5px] outline-you"
          />
        )}
      </div>
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
