import { Tooltip } from '@base-ui/react/tooltip';
import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import {
  isAwaitingYou,
  isSameRow,
  isWaitingToRun,
  type RoundRowKey,
  stopRows,
  visibleRows,
} from '../lib/round-rows.ts';
import type { Select, Selected } from '../lib/selection.ts';
import { isShortcutBlockedTarget } from '../lib/shortcut-target.ts';
import { turnMark } from '../lib/turn-summary.ts';
import type { Decision } from '../state/inspector-state.ts';
import { RoundRow } from './rounds/RoundRow.tsx';
import { TurnRow } from './rounds/TurnRow.tsx';

const ARROW_STEP: Readonly<Record<string, number | undefined>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * Every round of the run, newest last, with the selected round's turns nested under it. ↑/↓ move
 * through the rows in order.
 */
export const RoundList = ({
  selected,
  select,
  pending,
}: {
  selected: Selected;
  select: Select;
  /** The decisions the runs wait on; a turn with one reads "Your turn" on its round. */
  pending: readonly Decision[];
}) => {
  const { run, round: current, turn: currentTurn } = selected;
  const navRef = useRef<HTMLElement | null>(null);
  // Set by an arrow pressed inside the list: the row it selects takes focus once it renders.
  const followsFocus = useRef(false);
  const rows = visibleRows(run?.rounds ?? [], current?.round);
  const currentRow: RoundRowKey | undefined =
    current === undefined ? undefined : { round: current.round, turn: currentTurn?.turn };
  const isCurrentRow = (row: RoundRowKey) => currentRow !== undefined && isSameRow(row, currentRow);
  const stops = stopRows(rows, currentRow);
  const currentIndex = stops.findIndex(isCurrentRow);

  // Runs as the current row mounts, so it scrolls and takes focus only when the selection moves.
  const attachCurrentRow = useCallback((row: HTMLButtonElement | null) => {
    if (row === null) return;
    row.scrollIntoView({ block: 'nearest' });
    if (!followsFocus.current) return;
    followsFocus.current = false;
    row.focus({ preventScroll: true });
  }, []);

  // Focus inside the list keeps its arrows (a clicked row holds focus); elsewhere, the usual skip applies.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const step = ARROW_STEP[event.key];
    if (step === undefined || event.repeat) return;
    const isInList =
      event.target instanceof Node && navRef.current?.contains(event.target) === true;
    if (!isInList && isShortcutBlockedTarget(event.target)) return;
    const target = stops[currentIndex + step];
    if (target === undefined || run === undefined) return;
    event.preventDefault();
    followsFocus.current = isInList;
    select({ runId: run.runId, ...target });
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Rounds"
      className="overflow-auto border-r border-line px-2.5 py-3.5"
    >
      <h2 className="px-2.5 pb-2 text-xs font-semibold text-muted">Rounds</h2>
      <Tooltip.Provider delay={400}>
        <ol>
          {run !== undefined &&
            run.rounds.map(round => {
              const isSelectedRound = round.round === current?.round;
              const isStepWaiting = isWaitingToRun(pending, run.runId, round.round);
              return (
                <li key={round.round}>
                  <RoundRow
                    round={round}
                    isYourTurn={round.turns.some(turn =>
                      isAwaitingYou(pending, run.runId, round.round, turn.turn),
                    )}
                    isWaitingToRun={isStepWaiting}
                    isSelected={isSelectedRound}
                    ref={isCurrentRow({ round: round.round }) ? attachCurrentRow : undefined}
                    onSelect={() => select({ runId: run.runId, round: round.round })}
                  />
                  {isSelectedRound && (
                    <ul>
                      {round.turns.map(turn => {
                        const isAwaiting = isAwaitingYou(
                          pending,
                          run.runId,
                          round.round,
                          turn.turn,
                        );
                        return (
                          <li key={turn.turn}>
                            <TurnRow
                              turn={turn}
                              mark={turnMark(turn, { isAwaitingYou: isAwaiting })}
                              isSelected={turn.turn === currentTurn?.turn}
                              ref={
                                isCurrentRow({ round: round.round, turn: turn.turn })
                                  ? attachCurrentRow
                                  : undefined
                              }
                              onSelect={() =>
                                select({ runId: run.runId, round: round.round, turn: turn.turn })
                              }
                            />
                          </li>
                        );
                      })}
                      {isStepWaiting && (
                        <li className="py-1 ps-7 pe-2.5 text-[13px] font-semibold text-you">
                          → waiting to run
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
        </ol>
      </Tooltip.Provider>
    </nav>
  );
};
