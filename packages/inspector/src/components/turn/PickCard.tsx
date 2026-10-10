import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { isKeyBlocked } from '../../lib/key-target.ts';
import { pickTrail, stepCall } from '../../lib/pick-card.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision, PickedStep, Round } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { controlClass } from '../run/RunControls.tsx';

/**
 * A picked step waiting to run, above the selected turn. Run (S) is the same send as Step; Pick
 * again (R) drops the pick and asks the round's turns afresh.
 */
export const PickCard = ({
  round,
  picked,
  decision,
  act,
}: {
  round: Round;
  picked: PickedStep;
  decision: Decision;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { send, error } = useAction(act);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat || isKeyBlocked(event.target)) return;
    if (event.key !== 'r' && event.key !== 'R') return;
    event.preventDefault();
    void send({ type: 'repick', decision: decision.id });
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <section aria-label="The pick" className="mb-8">
      <p className="font-mono text-xs text-muted">round {round.round} · ready to run</p>
      <div className="mt-2 rounded-xl border border-line bg-raised p-5">
        <p className="font-mono text-xs text-muted">the pick</p>
        <p className="mt-1 break-words font-mono text-xl font-semibold tracking-tight text-ink">
          {stepCall(round, picked)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-xs text-muted">
          {pickTrail(round).map(entry => (
            <span key={entry.turn} className="rounded-[3px] border border-line px-1.5 py-px">
              turn {entry.turn} · {entry.by}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            onClick={() => void send({ type: 'run', decision: decision.id })}
            className={cn(controlClass(true, false), 'h-8 px-3 text-[13px]')}
          >
            Run
            <Keycap>S</Keycap>
          </Button>
          <Button
            type="button"
            onClick={() => void send({ type: 'repick', decision: decision.id })}
            className={cn(controlClass(false, false), 'h-8 px-3 text-[13px]')}
          >
            Pick again
            <Keycap>R</Keycap>
          </Button>
          <p className="text-xs text-muted">
            {`Pick again drops this pick and asks round ${round.round}'s turns afresh.`}
          </p>
        </div>
        {error !== undefined && (
          <p role="alert" className="mt-2 text-xs text-you">
            {error}
          </p>
        )}
      </div>
    </section>
  );
};
