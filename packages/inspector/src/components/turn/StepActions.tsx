import { Button } from '@base-ui/react/button';
import type { Action } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { isPageKey } from '../../lib/key-target.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { actionClass } from '../run/RunControls.tsx';

/**
 * The picked step waiting to run, under the turn it was picked on. Confirm (↵) runs it, the same as
 * Step in the header; a turn of the round is picked again from its own view.
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
      <Button
        type="button"
        onClick={() => void send({ type: 'run', decision: decision.id })}
        className={actionClass(true)}
      >
        Confirm
        <Keycap>↵</Keycap>
      </Button>
      {error !== undefined && (
        <p role="alert" className="mt-2 text-xs text-you">
          {error}
        </p>
      )}
    </section>
  );
};
