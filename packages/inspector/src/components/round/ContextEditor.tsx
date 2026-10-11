import { contextProblemOf, type EditDraft, withContext } from '../../lib/edit-draft.ts';

/** The context as JSON text, which a re-pick reads back: it must be an object with a string goal. */
export const ContextEditor = ({
  draft,
  onDraft,
}: {
  draft: EditDraft;
  onDraft: (draft: EditDraft) => void;
}) => {
  const problem = contextProblemOf(draft);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <textarea
        aria-label="Context JSON"
        aria-invalid={problem !== undefined}
        value={draft.context}
        spellCheck={false}
        onChange={event => onDraft(withContext(draft, event.target.value))}
        className="min-h-[18rem] w-full flex-1 resize-none rounded-md border border-line bg-ground p-3 font-mono text-[12px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-ink aria-invalid:border-you"
      />
      {problem !== undefined && <p className="font-mono text-xs text-you">{problem}</p>}
    </div>
  );
};
