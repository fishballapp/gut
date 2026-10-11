import { Button } from '@base-ui/react/button';
import { cn } from '@fishballapps/cn';
import type { Action } from '@gut.run/core/inspector';
import { useEffect, useEffectEvent, useMemo } from 'react';
import type { ActOutcome } from '../lib/connection.ts';
import { copyBackOf } from '../lib/edit-copy.ts';
import { contextProblemOf, editsOf, roundEdits } from '../lib/edit-draft.ts';
import { isPageKey } from '../lib/key-target.ts';
import type { Selected } from '../lib/selection.ts';
import type { RoundEdit } from '../lib/use-edit-draft.ts';
import { ContextEditor } from './round/ContextEditor.tsx';
import { ContextTree } from './round/ContextTree.tsx';
import { CopyBackPanel } from './round/CopyBackPanel.tsx';
import { EditBar } from './round/EditBar.tsx';
import { OpTree } from './round/OpTree.tsx';
import { OpTreeEditor } from './round/OpTreeEditor.tsx';
import { RoundSummary } from './round/RoundSummary.tsx';
import { Keycap } from './run/Keycap.tsx';
import { controlClass } from './run/RunControls.tsx';

/**
 * The selected round: what it picked, its op tree, and the context the task returned. While a
 * decision waits for it, E edits what the model reads; the edits are picked again with, or discarded.
 */
export const RoundPanel = ({
  selected,
  edit,
  act,
}: {
  selected: Selected;
  edit: RoundEdit;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { run, round } = selected;
  const { decision, draft } = edit;
  const copy = useMemo(() => {
    if (round === undefined || roundEdits(round).length === 0) return undefined;
    return copyBackOf(round.ops, round.context, roundEdits(round));
  }, [round]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isPageKey(event)) return;
    if (event.key !== 'e' && event.key !== 'E') return;
    // Once editing, the edit bar owns the draft: it is picked again with, or discarded, never closed silently.
    if (decision === undefined || draft !== undefined) return;
    event.preventDefault();
    edit.start();
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <aside
      aria-label="Round"
      className="overflow-auto border-t border-line p-5 lg:border-t-0 lg:border-l"
    >
      {round !== undefined && (
        <div key={round.round} className="flex min-w-0 flex-col gap-6">
          <RoundSummary round={round} run={run} />
          {decision !== undefined && draft !== undefined ? (
            <>
              <EditBar
                decision={decision}
                edits={editsOf(round.ops, round.context, draft)}
                problem={contextProblemOf(draft)}
                act={act}
                onDiscard={edit.stop}
                onSent={edit.stop}
              />
              <OpTreeEditor ops={round.ops} draft={draft} onDraft={edit.change} />
              <ContextEditor draft={draft} onDraft={edit.change} />
            </>
          ) : (
            <>
              {decision !== undefined && (
                <div>
                  <Button
                    type="button"
                    onClick={edit.start}
                    className={cn(controlClass(false, false), 'h-8 px-3 text-[13px]')}
                  >
                    Edit
                    <Keycap>E</Keycap>
                  </Button>
                </div>
              )}
              {copy !== undefined && <CopyBackPanel copy={copy} />}
              <OpTree ops={round.ops} pickedAddress={round.picked?.address} />
              <ContextTree context={round.context} />
            </>
          )}
        </div>
      )}
    </aside>
  );
};
