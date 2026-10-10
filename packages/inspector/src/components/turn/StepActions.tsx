import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { isPageKey } from '../../lib/key-target.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { controlClass } from '../run/RunControls.tsx';

/**
 * The picked step waiting to run, under the turn it was picked on. Confirm (↵) runs it, the same as
 * Step in the header; Pick again (R) drops the pick and asks the round's turns afresh.
 */
export const StepActions = ({
  round,
  decision,
  pickedCall,
  act,
}: {
  round: number;
  decision: Decision;
  /** Names the step when the round asked no turn to show it, a lone option needing no question. */
  pickedCall?: string;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { send, error } = useAction(act);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isPageKey(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void send({ type: 'run', decision: decision.id });
      return;
    }
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      void send({ type: 'repick', decision: decision.id });
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <section aria-label="The pick" className="mt-6">
      {pickedCall !== undefined && (
        <div className="mb-3">
          <p className="font-mono text-xs text-muted">round {round} · ready to run</p>
          <p className="mt-1 break-words font-mono text-xl font-semibold tracking-tight text-ink">
            {pickedCall}
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          onClick={() => void send({ type: 'run', decision: decision.id })}
          className={cn(controlClass(true, false), 'h-8 px-3 text-[13px]')}
        >
          Confirm
          <Keycap>↵</Keycap>
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
          {`Confirm runs this pick. Pick again drops it and asks round ${round}'s turns afresh.`}
        </p>
      </div>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-you">
          {error}
        </p>
      )}
    </section>
  );
};
