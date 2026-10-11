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
    <section aria-label="Context" className="min-w-0">
      <h3 className="pb-2 text-xs font-semibold text-muted">Context</h3>
      <textarea
        aria-label="Context JSON"
        aria-invalid={problem !== undefined}
        value={draft.context}
        rows={10}
        spellCheck={false}
        onChange={event => onDraft(withContext(draft, event.target.value))}
        className="w-full resize-y rounded-md border border-line bg-raised p-2 font-mono text-[12px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-ink aria-invalid:border-you"
      />
      {problem !== undefined && <p className="pt-1 font-mono text-xs text-you">{problem}</p>}
    </section>
  );
};
