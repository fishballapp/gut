import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@fishballapps/cn';
import type { OpAddress, OpChoiceNode, OpTreeNode } from '@gut.run/core/inspector';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { isOnPath } from '../../lib/op-path.ts';
import { revealWithin } from '../../lib/reveal.ts';
import { countLabel, nodeTag } from '../../lib/round-panel.ts';

const nodeKey = (node: OpTreeNode): string =>
  [...node.address.keys, node.address.choice].filter(part => part !== undefined).join('.');

/** What a node reads as: a choice's label, else its description. */
const textOf = (node: OpTreeNode): string =>
  node.kind === 'choice' ? node.label : node.description;

/** On hover: the whole text, and where the node sits in the task's code. */
const titleOf = (node: OpTreeNode): string => {
  const { keys, choice } = node.address;
  return `${textOf(node)}\n${keys.join('.')}${choice === undefined ? '' : `[${choice}]`}`;
};

type Place = 'picked' | 'path' | 'off';

const placeOf = (node: OpTreeNode, pickedAddress: OpAddress | null): Place => {
  if (pickedAddress === null || !isOnPath(node.address, pickedAddress)) return 'off';
  return node.kind === 'op' || node.kind === 'choice' ? 'picked' : 'path';
};

/**
 * One node's line: a caret when it folds, its kind, its text, and what it holds. The picked move is
 * marked like a chosen option, and the groups above it read in ink.
 */
const NodeLine = ({
  node,
  place,
  isOpen,
}: {
  node: OpTreeNode;
  place: Place;
  isOpen?: boolean;
}) => {
  const tag = nodeTag(node);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {isOpen === undefined ? (
        <span aria-hidden className="w-3 shrink-0" />
      ) : (
        <CaretRightIcon
          size={12}
          weight="bold"
          aria-hidden
          className={cn(
            'relative top-px shrink-0 text-faint transition-transform motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
        />
      )}
      {tag !== undefined && (
        <span className="w-[2.25rem] shrink-0 font-sans text-[11px] text-muted">{tag}</span>
      )}
      <span
        className={cn(
          'min-w-0 truncate',
          place === 'off' && 'text-muted',
          place === 'path' && 'font-semibold text-ink',
          place === 'picked' && 'bg-highlight px-0.5 font-semibold text-chosen',
        )}
      >
        {textOf(node)}
      </span>
      {place === 'picked' && <span className="sr-only">picked</span>}
      {(node.kind === 'group' || node.kind === 'choices') && (
        <span className="shrink-0 text-muted">{countLabel(node)}</span>
      )}
    </span>
  );
};

/** Every choice of an op, in a scrolling container; the picked one is brought into view. */
const ChoiceList = ({
  choices,
  pickedAddress,
}: {
  choices: OpChoiceNode[];
  pickedAddress: OpAddress | null;
}) => {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-picked]');
    if (list !== null && list !== undefined && row !== null && row !== undefined) {
      revealWithin(list, row);
    }
  }, []);

  return (
    <ul
      ref={listRef}
      className="relative ms-[5px] max-h-72 overflow-y-auto border-l border-line ps-2"
    >
      {choices.map(choice => {
        const place = placeOf(choice, pickedAddress);
        return (
          <li
            key={nodeKey(choice)}
            title={titleOf(choice)}
            data-picked={place === 'picked' || undefined}
            className="py-px"
          >
            <NodeLine node={choice} place={place} />
          </li>
        );
      })}
    </ul>
  );
};

/** A group, or an op with choices: folded unless the picked move is inside it. */
const FoldableNode = ({
  node,
  pickedAddress,
}: {
  node: Extract<OpTreeNode, { kind: 'group' | 'choices' }>;
  pickedAddress: OpAddress | null;
}) => {
  const place = placeOf(node, pickedAddress);
  const [isOpen, setIsOpen] = useState(place !== 'off');
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="min-w-0">
      <Collapsible.Trigger
        title={titleOf(node)}
        className="flex w-full min-w-0 rounded-sm py-px text-left focus-visible:outline-2 focus-visible:outline-ink"
      >
        <NodeLine node={node} place={place} isOpen={isOpen} />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {node.kind === 'group' ? (
          <OpNodeList nodes={node.children} pickedAddress={pickedAddress} />
        ) : (
          <ChoiceList choices={node.children} pickedAddress={pickedAddress} />
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

const OpNodeList = ({
  nodes,
  pickedAddress,
  isRoot = false,
}: {
  nodes: OpTreeNode[];
  pickedAddress: OpAddress | null;
  isRoot?: boolean;
}) => (
  <ul className={cn(!isRoot && 'ms-[5px] border-l border-line ps-2')}>
    {nodes.map(node => (
      <li key={nodeKey(node)} className="min-w-0">
        {node.kind === 'group' || node.kind === 'choices' ? (
          <FoldableNode node={node} pickedAddress={pickedAddress} />
        ) : (
          <div title={titleOf(node)} className="py-px">
            <NodeLine node={node} place={placeOf(node, pickedAddress)} />
          </div>
        )}
      </li>
    ))}
  </ul>
);

/**
 * The round's op tree, folded down to its top level and the way to the picked move, which is marked.
 * The caller keys it by the pick, so the folds follow a new pick.
 */
export const OpTree = ({
  ops,
  pickedAddress,
}: {
  ops: OpTreeNode[];
  pickedAddress: OpAddress | null | undefined;
}) => (
  <div className="font-mono text-[12px] leading-relaxed">
    <OpNodeList nodes={ops} pickedAddress={pickedAddress ?? null} isRoot />
  </div>
);
