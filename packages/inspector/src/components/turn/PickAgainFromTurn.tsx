import { Button } from '@base-ui/react/button';
import type { Action } from '@gut.run/core/inspector';
import { cn } from 'cn';
import { useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { pickAgainNote } from '../../lib/pick-again.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision } from '../../state/inspector-state.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { controlClass } from '../run/RunControls.tsx';

/**
 * Picks the round again from this turn, which asks first: the turns from here on are cleared.
 * `onPicked` runs once the CLI took it.
 */
export const PickAgainFromTurn = ({
  turn,
  lastTurn,
  decision,
  act,
  onPicked,
}: {
  turn: number;
  lastTurn: number;
  decision: Decision;
  act: (action: Action) => Promise<ActOutcome>;
  onPicked: () => void;
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const { send, error } = useAction(act);

  const pickAgain = async () => {
    const isSent = await send({ type: 'repick', decision: decision.id, fromTurn: turn });
    if (isSent) onPicked();
  };

  return (
    <>
      {/* As tall as the sort toggle beside it. */}
      <Button
        type="button"
        onClick={() => setIsConfirming(true)}
        className={cn(controlClass(false, false), 'h-[30px]')}
      >
        Pick again
      </Button>
      {error !== undefined && (
        <p role="alert" className="text-xs text-you">
          {error}
        </p>
      )}
      <ConfirmDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title={`Pick again from turn ${turn}?`}
        description={pickAgainNote(turn, lastTurn)}
        cancel="Cancel"
        confirm="Pick again"
        onConfirm={() => void pickAgain()}
      />
    </>
  );
};
