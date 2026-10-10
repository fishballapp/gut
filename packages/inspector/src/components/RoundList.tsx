import { Tooltip } from '@base-ui/react/tooltip';
import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { currentTurnOf, roundCurrentState, rowCurrentState } from '../lib/current-turn.ts';
import { isSameRow, type RoundRowKey, stopRows, visibleRows } from '../lib/round-rows.ts';
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
  /** The decisions the runs wait on: the run's current turn is marked from them. */
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
              const running = currentTurnOf(round, run.runId, pending);
              const roundState = roundCurrentState(round, run.runId, pending);
              return (
                <li key={round.round}>
                  <RoundRow
                    round={round}
                    current={rowCurrentState(roundState, {
                      isSelected: isSelectedRound,
                      turnCount: round.turns.length,
                    })}
                    isSelected={isSelectedRound}
                    ref={isCurrentRow({ round: round.round }) ? attachCurrentRow : undefined}
                    onSelect={() => select({ runId: run.runId, round: round.round })}
                  />
                  {isSelectedRound && (
                    <ul>
                      {round.turns.map(turn => {
                        const turnState = running?.turn === turn.turn ? running.state : undefined;
                        return (
                          <li key={turn.turn}>
                            <TurnRow
                              turn={turn}
                              mark={turnMark(turn, turnState)}
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
