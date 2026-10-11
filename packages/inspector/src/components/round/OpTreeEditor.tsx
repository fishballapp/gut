import type { OpAddress, OpTreeNode } from '@gut.run/core/inspector';
import {
  addressKey,
  type EditDraft,
  observedTextOf,
  pathOf,
  withHidden,
  withText,
} from '../../lib/edit-draft.ts';
import { nodeTag } from '../../lib/round-panel.ts';

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
  return (
    <button
      type="button"
      aria-label={`${isHidden ? 'Show' : 'Hide'} ${pathOf(address)}`}
      onClick={() => onDraft(withHidden(draft, address, !isHidden))}
      className="w-10 shrink-0 rounded-md py-0.5 font-sans text-xs text-muted hover:bg-ground hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
    >
      {isHidden ? 'Show' : 'Hide'}
    </button>
  );
};

/** One op, group or choice: its hide toggle, its kind, and its text, then what it holds. */
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
  const tag = nodeTag(node);
  return (
    <li className="min-w-0 py-0.5">
      <div className="flex min-w-0 items-center gap-2" title={pathOf(node.address)}>
        <HideToggle address={node.address} draft={draft} onDraft={onDraft} />
        {tag !== undefined && (
          <span className="w-[2.25rem] shrink-0 font-sans text-[11px] text-muted">{tag}</span>
        )}
        <input
          type="text"
          aria-label={`${isChoice ? 'Label' : 'Description'} of ${pathOf(node.address)}`}
          value={text}
          disabled={isHidden}
          spellCheck={false}
          onChange={event => onDraft(withText(draft, node.address, event.target.value))}
          className="min-w-0 flex-1 rounded-md border border-line bg-ground px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:text-muted disabled:line-through"
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
  isRoot = false,
}: {
  nodes: OpTreeNode[];
  draft: EditDraft;
  onDraft: OnDraft;
  isRoot?: boolean;
}) => (
  <ul className={isRoot ? undefined : 'ms-[1.375rem] border-l border-line ps-3'}>
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
  <div className="font-mono text-[12px]">
    <EditNodeList nodes={ops} draft={draft} onDraft={onDraft} isRoot />
  </div>
);
