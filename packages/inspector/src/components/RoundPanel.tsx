import type { Action } from '@gut.run/core/inspector';
import { cn } from 'cn';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { type ActOutcome, isReplay } from '../lib/connection.ts';
import { copyBackOf } from '../lib/edit-copy.ts';
import { roundEdits } from '../lib/edit-draft.ts';
import { isPageKey } from '../lib/key-target.ts';
import { roundNote } from '../lib/round-panel.ts';
import type { Selected } from '../lib/selection.ts';
import type { Decision } from '../state/inspector-state.ts';
import { ContextTree } from './round/ContextTree.tsx';
import { CopyBackPanel } from './round/CopyBackPanel.tsx';
import { EditDialog, type EditPart } from './round/EditDialog.tsx';
import { OpTree } from './round/OpTree.tsx';
import { CopyButton, Section, sectionButtonClass } from './round/Section.tsx';
import { Keycap } from './run/Keycap.tsx';

/**
 * The selected round: the context the task returned, then its op tree with the picked move. While a
 * decision waits for it, each can be edited in a dialog (E opens the op tree's), and saving picks the
 * round again with the edits.
 */
export const RoundPanel = ({
  selected,
  decision,
  act,
}: {
  selected: Selected;
  /** The decision waiting for the selected round: editing is open only while there is one. */
  decision: Decision | undefined;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { run, round } = selected;
  // An edit belongs to the decision it opened on: once that decision ends (answered here or in
  // another tab, or re-picked), the dialog closes rather than save its draft to the next one.
  const [editing, setEditing] = useState<{ part: EditPart; decision: string }>();
  const isEditOpen = editing !== undefined && editing.decision === decision?.id;
  const copy = useMemo(() => {
    if (round === undefined || roundEdits(round).length === 0) return undefined;
    return copyBackOf(round.ops, round.context, roundEdits(round));
  }, [round]);
  const note = round === undefined ? undefined : roundNote(round, run);
  const pickedKey = JSON.stringify(round?.picked?.address ?? null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isPageKey(event)) return;
    if (event.key !== 'e' && event.key !== 'E') return;
    if (decision === undefined || isEditOpen) return;
    event.preventDefault();
    setEditing({ part: 'ops', decision: decision.id });
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const editButton = (part: EditPart) =>
    decision !== undefined && (
      <button
        type="button"
        onClick={() => setEditing({ part, decision: decision.id })}
        className={sectionButtonClass}
      >
        Edit
        {part === 'ops' && <Keycap>E</Keycap>}
      </button>
    );

  return (
    <aside
      aria-label="Round"
      className={cn(
        'overflow-auto border-t border-line p-5 lg:border-t-0 lg:border-l',
        isReplay && 'max-lg:order-1',
      )}
    >
      {round !== undefined && (
        <div key={round.round} className="flex min-w-0 flex-col gap-7">
          <header className="space-y-1">
            <h2 className="text-[15px] font-semibold">Round {round.round}</h2>
            {note !== undefined && (
              <p
                className={
                  note.kind === 'error' ? 'text-[13px] text-you' : 'text-[13px] text-muted'
                }
              >
                {note.text}
              </p>
            )}
          </header>
          {copy !== undefined && <CopyBackPanel copy={copy} />}
          <Section
            title="Context"
            actions={
              <>
                <CopyButton text={() => JSON.stringify(round.context, null, 2)} />
                {editButton('context')}
              </>
            }
          >
            <ContextTree context={round.context} />
          </Section>
          <Section title="Op tree" actions={editButton('ops')}>
            <OpTree key={pickedKey} ops={round.ops} pickedAddress={round.picked?.address} />
          </Section>
        </div>
      )}
      {round !== undefined && decision !== undefined && isEditOpen && (
        <EditDialog
          key={editing.decision}
          part={editing.part}
          round={round}
          decision={decision}
          act={act}
          onClose={() => setEditing(undefined)}
        />
      )}
    </aside>
  );
};
