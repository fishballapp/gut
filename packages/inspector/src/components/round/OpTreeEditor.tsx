import type { OpAddress, OpTreeNode } from '@gut.run/core/inspector';
import {
  addressKey,
  type EditDraft,
  observedTextOf,
  pathOf,
  withHidden,
  withText,
} from '../../lib/edit-draft.ts';

type OnDraft = (draft: EditDraft) => void;

const HideToggle = ({
  address,
  draft,
  onDraft,
}: {
  address: OpAddress;
  draft: EditDraft;
  onDraft: OnDraft;
}) => {
  const isHidden = draft.hidden[addressKey(address)] === true;
  const path = pathOf(address);
  return (
    <button
      type="button"
      aria-label={`${isHidden ? 'Show' : 'Hide'} ${path}`}
      onClick={() => onDraft(withHidden(draft, address, !isHidden))}
      className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-sans text-xs text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      {isHidden ? 'Show' : 'Hide'}
    </button>
  );
};

/** One op, group or choice: its hide toggle, its key and its text, then what it holds. */
const EditNode = ({
  node,
  draft,
  onDraft,
}: {
  node: OpTreeNode;
  draft: EditDraft;
  onDraft: OnDraft;
}) => {
  const isChoice = node.kind === 'choice';
  const isHidden = draft.hidden[addressKey(node.address)] === true;
  const text = draft.texts[addressKey(node.address)] ?? observedTextOf(node);
  const shownKey = isChoice ? `[${node.address.choice ?? ''}]` : (node.address.keys.at(-1) ?? '');
  return (
    <li className="min-w-0 py-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <HideToggle address={node.address} draft={draft} onDraft={onDraft} />
        <span className="shrink-0 text-muted">{shownKey}</span>
        <input
          type="text"
          aria-label={`${isChoice ? 'Label' : 'Description'} of ${pathOf(node.address)}`}
          value={text}
          disabled={isHidden}
          spellCheck={false}
          onChange={event => onDraft(withText(draft, node.address, event.target.value))}
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-0.5 text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-muted"
        />
      </div>
      {(node.kind === 'group' || node.kind === 'choices') && (
        <EditNodeList nodes={node.children} draft={draft} onDraft={onDraft} />
      )}
    </li>
  );
};

const EditNodeList = ({
  nodes,
  draft,
  onDraft,
}: {
  nodes: OpTreeNode[];
  draft: EditDraft;
  onDraft: OnDraft;
}) => (
  <ul className="ms-3 border-l border-line ps-3">
    {nodes.map(node => (
      <EditNode key={addressKey(node.address)} node={node} draft={draft} onDraft={onDraft} />
    ))}
  </ul>
);

/** The op tree with each op's and group's description and each choice's label editable, and moves hideable. */
export const OpTreeEditor = ({
  ops,
  draft,
  onDraft,
}: {
  ops: OpTreeNode[];
  draft: EditDraft;
  onDraft: OnDraft;
}) => (
  <section aria-label="Op tree" className="min-w-0">
    <h3 className="pb-2 text-xs font-semibold text-muted">Op tree</h3>
    <EditNodeList nodes={ops} draft={draft} onDraft={onDraft} />
  </section>
);
