import { useEffect, useEffectEvent, useRef } from 'react';
import type { Select, Selected } from '../lib/selection.ts';
import { isShortcutBlockedTarget } from '../lib/shortcut-target.ts';
import { adjacentRound } from '../lib/strip-block.ts';
import type { Decision } from '../state/inspector-state.ts';
import { RoundGroup } from './strip/RoundGroup.tsx';

/** The run's rounds at a glance, each a group of its turns. ←/→ step between rounds. */
export const RoundStrip = ({
  selected,
  select,
  pending,
}: {
  selected: Selected;
  select: Select;
  pending: readonly Decision[];
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedBlockRef = useRef<HTMLButtonElement>(null);
  const { run, round: current, turn: currentTurn } = selected;
  // Changes with the selected run, round or turn, so the block scrolls only when the selection moves.
  const selectedKey =
    run === undefined || current === undefined || currentTurn === undefined
      ? undefined
      : `${run.runId}/${current.round}/${currentTurn.turn}`;

  useEffect(() => {
    if (selectedKey === undefined) return;
    selectedBlockRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedKey]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) return;
    // The strip's own blocks take the arrows: a block is a button, which is otherwise a blocked target.
    const target = event.target;
    const isInStrip = target instanceof Node && rootRef.current?.contains(target) === true;
    if (!isInStrip && isShortcutBlockedTarget(target)) return;
    if (run === undefined || current === undefined) return;
    const next = adjacentRound(run.rounds, current.round, event.key === 'ArrowLeft' ? -1 : 1);
    if (next === undefined) return;
    event.preventDefault();
    select({ runId: run.runId, round: next.round });
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (run === undefined || run.rounds.length === 0) return <div className="pb-4" />;
  return (
    <div ref={rootRef} className="overflow-x-auto py-4">
      <ol aria-label="Rounds at a glance" className="flex w-max gap-3.5 px-1.5 py-1">
        {run.rounds.map(round => {
          const isSelected = round.round === current?.round;
          return (
            <RoundGroup
              key={round.round}
              run={run}
              round={round}
              isSelected={isSelected}
              selectedTurn={currentTurn?.turn}
              selectedBlockRef={selectedBlockRef}
              pending={pending}
              select={select}
            />
          );
        })}
      </ol>
    </div>
  );
};
