import { Tooltip } from '@base-ui/react/tooltip';
import { cn } from 'cn';
import { useEffect, useEffectEvent, useRef } from 'react';
import { isReplay } from '../lib/connection.ts';
import { currentTurnOf, roundCurrentState } from '../lib/current-turn.ts';
import { revealNearest } from '../lib/reveal.ts';
import type { Select, Selected } from '../lib/selection.ts';
import { isShortcutBlockedTarget } from '../lib/shortcut-target.ts';
import {
  adjacentRound,
  adjacentStop,
  blockLook,
  blockName,
  isRoundWaiting,
} from '../lib/turn-block.ts';
import type { Decision, Round, Run } from '../state/inspector-state.ts';
import { RailTip, RoundTipContent, TurnTipContent } from './rail/RailTip.tsx';
import { CurrentDot, TurnBlock } from './rail/TurnBlock.tsx';

const ARROWS: Readonly<Record<string, { axis: 'round' | 'turn'; step: -1 | 1 } | undefined>> = {
  ArrowUp: { axis: 'round', step: -1 },
  ArrowDown: { axis: 'round', step: 1 },
  ArrowLeft: { axis: 'turn', step: -1 },
  ArrowRight: { axis: 'turn', step: 1 },
};

/**
 * Every round of the run, newest last, each its turns' bars stacked; what a round or turn holds
 * shows on hover. ↑/↓ move between rounds, ←/→ through the turns.
 */
export const RoundRail = ({
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
  // Set by an arrow pressed inside the rail: what it selects takes focus once it renders.
  const followsFocus = useRef(false);
  // Changes with the selected run, round or turn, so the rail scrolls only when the selection moves.
  const selectedKey =
    run === undefined || current === undefined
      ? undefined
      : `${run.runId}/${current.round}/${currentTurn?.turn ?? ''}`;

  useEffect(() => {
    const nav = navRef.current;
    if (selectedKey === undefined || nav === null) return;
    const target = nav.querySelector<HTMLElement>('[data-rail-selected]');
    if (target === null) return;
    revealNearest(nav, target);
    if (!followsFocus.current) return;
    followsFocus.current = false;
    target.focus({ preventScroll: true });
  }, [selectedKey]);

  // Focus inside the rail keeps its arrows (a clicked block holds focus); elsewhere, the usual skip applies.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const arrow = ARROWS[event.key];
    if (arrow === undefined || event.repeat) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const isInRail =
      event.target instanceof Node && navRef.current?.contains(event.target) === true;
    if (!isInRail && isShortcutBlockedTarget(event.target)) return;
    if (run === undefined || current === undefined) return;
    const next =
      arrow.axis === 'round'
        ? (() => {
            const round = adjacentRound(run.rounds, current.round, arrow.step);
            return round === undefined ? undefined : { round: round.round };
          })()
        : adjacentStop(run.rounds, { round: current.round, turn: currentTurn?.turn }, arrow.step);
    if (next === undefined) return;
    event.preventDefault();
    followsFocus.current = isInRail;
    select({ runId: run.runId, ...next });
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label="Rounds"
      className={cn(
        'relative overflow-auto border-line px-3 py-3.5 lg:border-r',
        // A replay on a phone opens on the turn: the rail follows it rather than pushing it down.
        isReplay && 'max-lg:order-1 max-lg:border-t',
      )}
    >
      <h2 className="px-1.5 pb-2 text-xs font-semibold text-muted">Rounds</h2>
      <Tooltip.Provider delay={300}>
        <ol className="flex flex-col gap-0.5">
          {run?.rounds.map(round => (
            <RailRound
              key={round.round}
              run={run}
              round={round}
              isSelected={round.round === current?.round}
              selectedTurn={currentTurn?.turn}
              pending={pending}
              select={select}
            />
          ))}
        </ol>
      </Tooltip.Provider>
    </nav>
  );
};

/**
 * One round: its number, which selects it and says what it did on hover, then its turns' bars, one
 * under another. A round whose pick needed no turn shows a dash, or an empty bar that pulses while it
 * waits to run.
 */
const RailRound = ({
  run,
  round,
  isSelected,
  selectedTurn,
  pending,
  select,
}: {
  run: Run;
  round: Round;
  isSelected: boolean;
  selectedTurn: number | undefined;
  pending: readonly Decision[];
  select: Select;
}) => {
  const isWaiting = isRoundWaiting(run.runId, round.round, pending);
  const current = currentTurnOf(round, run.runId, pending);
  const roundState = roundCurrentState(round, run.runId, pending);
  const hasTurns = round.turns.length > 0;
  const rowRef = useRef<HTMLLIElement>(null);
  return (
    <li
      ref={rowRef}
      className={cn(
        'grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-1 rounded-md px-1.5 py-1.5',
        isSelected && 'bg-raised',
      )}
    >
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <button
              type="button"
              aria-label={`round ${round.round}`}
              aria-current={isSelected}
              data-rail-selected={(isSelected && !hasTurns) || undefined}
              onClick={() => select({ runId: run.runId, round: round.round })}
              className={cn(
                'h-4 rounded-sm text-left font-mono text-xs leading-4 tabular-nums focus-visible:outline-2 focus-visible:outline-ink',
                isWaiting && 'text-you',
                !isWaiting && (isSelected ? 'font-semibold text-ink' : 'text-muted hover:text-ink'),
              )}
            />
          }
        >
          {round.round}
        </Tooltip.Trigger>
        <RailTip row={rowRef}>
          <RoundTipContent round={round} state={roundState} />
        </RailTip>
      </Tooltip.Root>
      <div className="flex min-w-0 flex-col gap-1.5">
        {round.turns.map(turn => {
          const look = blockLook(turn);
          const turnState = current?.turn === turn.turn ? current.state : undefined;
          return (
            <TurnBlock
              key={turn.turn}
              look={look}
              name={blockName(round.round, turn.turn, look, turnState)}
              current={turnState}
              isSelected={isSelected && turn.turn === selectedTurn}
              tip={
                <RailTip row={rowRef}>
                  <TurnTipContent turn={turn} state={turnState} />
                </RailTip>
              }
              onSelect={() => select({ runId: run.runId, round: round.round, turn: turn.turn })}
            />
          );
        })}
        {!hasTurns &&
          (roundState === undefined ? (
            <span aria-hidden className="h-4 font-mono text-xs leading-4 text-faint">
              —
            </span>
          ) : (
            <span
              aria-hidden
              className="relative h-4 w-full rounded-[4px] outline outline-1 -outline-offset-px outline-faint motion-safe:animate-pulse"
            >
              <CurrentDot state={roundState} />
            </span>
          ))}
      </div>
    </li>
  );
};
