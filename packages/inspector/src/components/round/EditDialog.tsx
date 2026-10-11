import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import type { Action } from '@gut.run/core/inspector';
import { XIcon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import {
  contextProblemOf,
  editsOf,
  hasAnswersSoFar,
  isSameEdits,
  startDraft,
} from '../../lib/edit-draft.ts';
import { useAction } from '../../lib/use-action.ts';
import type { Decision, Round } from '../../state/inspector-state.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Keycap } from '../run/Keycap.tsx';
import { actionClass } from '../run/RunControls.tsx';
import { ContextEditor } from './ContextEditor.tsx';
import { OpTreeEditor } from './OpTreeEditor.tsx';

/** What a dialog edits: the op tree's texts and moves, or the context. */
export type EditPart = 'ops' | 'context';

const TITLES: Readonly<Record<EditPart, string>> = {
  ops: 'Edit the op tree',
  context: 'Edit the context',
};

/**
 * Edits one part of what the model reads in a waiting round. Save picks the round again with the
 * edits; when the round has answers to lose, it asks first. Edits from an earlier save carry over.
 */
export const EditDialog = ({
  part,
  round,
  decision,
  act,
  onClose,
}: {
  part: EditPart;
  round: Round;
  decision: Decision;
  act: (action: Action) => Promise<ActOutcome>;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState(() => startDraft(round));
  const [isConfirming, setIsConfirming] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { send, error } = useAction(act);
  const edits = editsOf(round.ops, round.context, draft);
  const problem = part === 'context' ? contextProblemOf(draft) : undefined;
  const canSave = problem === undefined && !isSameEdits(edits, round);

  const pickAgain = async () => {
    const isSent = await send({ type: 'repick', decision: decision.id, edits });
    if (isSent) onClose();
  };

  const save = () => {
    if (!canSave) return;
    if (hasAnswersSoFar(round)) {
      setIsConfirming(true);
      return;
    }
    void pickAgain();
  };

  return (
    <Dialog.Root
      open
      onOpenChange={isOpen => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-ground/70" />
        <Dialog.Popup
          // The first field takes focus, so typing starts the edit.
          initialFocus={() =>
            bodyRef.current?.querySelector<HTMLElement>('input, textarea') ?? true
          }
          onKeyDown={event => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            save();
          }}
          className="fixed top-1/2 left-1/2 flex h-[min(720px,calc(100vh-4rem))] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-raised shadow-lg"
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-[18px] font-semibold text-ink">
                {TITLES[part]}
              </Dialog.Title>
              <Dialog.Description className="text-[13px] text-muted">
                What the model reads in round {round.round}. Saving asks the round again with it.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-ground hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              <XIcon size={16} />
            </Dialog.Close>
          </div>
          <div
            ref={bodyRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto border-y border-line px-6 py-4"
          >
            {part === 'ops' ? (
              <OpTreeEditor ops={round.ops} draft={draft} onDraft={setDraft} />
            ) : (
              <ContextEditor draft={draft} onDraft={setDraft} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 px-6 py-4">
            <p className="me-auto font-mono text-xs text-muted tabular-nums">
              {edits.length === 0
                ? 'As the task wrote it'
                : `${edits.length} ${edits.length === 1 ? 'change' : 'changes'} from the task`}
            </p>
            {error !== undefined && (
              <p role="alert" className="text-xs text-you">
                {error}
              </p>
            )}
            <Dialog.Close className={actionClass(false)}>Cancel</Dialog.Close>
            <Button
              type="button"
              disabled={!canSave}
              focusableWhenDisabled
              onClick={save}
              className={actionClass(true, !canSave)}
            >
              Save
              <Keycap>⌘↵</Keycap>
            </Button>
          </div>
          <ConfirmDialog
            isOpen={isConfirming}
            onOpenChange={setIsConfirming}
            title={`Start round ${round.round} again?`}
            description="Saving drops this round's answers and asks it again from turn 1, with your edits."
            cancel="Keep editing"
            confirm="Save and start again"
            onConfirm={() => void pickAgain()}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
