import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action, Edit } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import { isPageKey } from '../../lib/key-target.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision } from '../../state/inspector-state.ts';
import { Keycap } from '../run/Keycap.tsx';
import { controlClass } from '../run/RunControls.tsx';

/**
 * The edits in progress on the waiting pick: how many, and Pick again with them (R), which re-picks
 * the round with what the model reads changed. While edits are open, this bar owns R, so a plain
 * re-pick cannot drop them.
 */
export const EditBar = ({
  decision,
  edits,
  problem,
  act,
  onDiscard,
  onSent,
}: {
  decision: Decision;
  edits: readonly Edit[];
  /** Why the edits cannot be picked with yet; Pick again waits for it to clear. */
  problem: string | undefined;
  act: (action: Action) => Promise<ActOutcome>;
  onDiscard: () => void;
  /** The CLI took the re-pick: the draft is now the round's edits, so it is done. */
  onSent: () => void;
}) => {
  const { send, error } = useAction(act);
  const isPickable = problem === undefined;
  const pickAgain = async () => {
    const isSent = await send({ type: 'repick', decision: decision.id, edits: [...edits] });
    if (isSent) onSent();
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isPageKey(event)) return;
    if (event.key !== 'r' && event.key !== 'R') return;
    event.preventDefault();
    if (isPickable) void pickAgain();
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const count = `${edits.length} ${edits.length === 1 ? 'change' : 'changes'}`;

  return (
    <section aria-label="Edits" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="font-mono text-xs tabular-nums text-muted">{count}</p>
        <Button
          type="button"
          disabled={!isPickable}
          onClick={pickAgain}
          className={cn(controlClass(true, false), 'h-8 px-3 text-[13px]')}
        >
          Pick again with edits
          <Keycap>R</Keycap>
        </Button>
        <Button
          type="button"
          onClick={onDiscard}
          className={cn(controlClass(false, false), 'h-8 px-3 text-[13px]')}
        >
          Discard
        </Button>
      </div>
      {error !== undefined && (
        <p role="alert" className="text-xs text-you">
          {error}
        </p>
      )}
    </section>
  );
};
