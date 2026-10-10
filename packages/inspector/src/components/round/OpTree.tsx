import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@fishballapps/cn';
import type { OpAddress, OpChoiceNode, OpTreeNode } from '@gut.run/core/inspector';
import { CaretRightIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { isOnPath } from '../../lib/op-path.ts';
import { choiceWindow, closedCountLabel } from '../../lib/round-panel.ts';

const nodeKey = (node: OpTreeNode): string => node.address.keys.at(-1) ?? '';

const pathClass = (isPicked: boolean) => (isPicked ? 'font-semibold text-chosen' : 'text-muted');

const PickedMark = ({ isPicked }: { isPicked: boolean }) =>
  isPicked ? <span className="sr-only">picked</span> : null;

const LeafRow = ({
  label,
  description,
  isPicked,
}: {
  label: string;
  description?: string;
  isPicked: boolean;
}) => (
  <span className={cn('flex min-w-0 items-baseline gap-2', pathClass(isPicked))}>
    <PickedMark isPicked={isPicked} />
    <span className="shrink-0">{label}</span>
    {description !== undefined && description.length > 0 && (
      <span className="truncate font-normal text-muted">{description}</span>
    )}
  </span>
);

const ChoiceList = ({
  choices,
  pickedAddress,
  pickedChoice,
}: {
  choices: OpChoiceNode[];
  pickedAddress: OpAddress | null;
  /** Choice index when this list is on the picked path; otherwise undefined. */
  pickedChoice: number | undefined;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleRange = choiceWindow(choices.length, pickedChoice);
  const range =
    isExpanded || visibleRange === 'all' ? { start: 0, end: choices.length } : visibleRange;
  const hiddenBefore = range.start;
  const hiddenAfter = choices.length - range.end;
  const visible = choices.slice(range.start, range.end);

  return (
    <ul className="ms-3 border-l border-line ps-3">
      {hiddenBefore > 0 && (
        <li>
          <button
            type="button"
            className="py-0.5 text-muted hover:text-ink"
            onClick={() => setIsExpanded(true)}
          >
            +{hiddenBefore} more
          </button>
        </li>
      )}
      {visible.map(choice => {
        const isPicked = pickedAddress !== null && isOnPath(choice.address, pickedAddress);
        return (
          <li key={choice.address.choice} className="py-0.5">
            <LeafRow label={choice.label} isPicked={isPicked} />
          </li>
        );
      })}
      {hiddenAfter > 0 && (
        <li>
          <button
            type="button"
            className="py-0.5 text-muted hover:text-ink"
            onClick={() => setIsExpanded(true)}
          >
            +{hiddenAfter} more
          </button>
        </li>
      )}
    </ul>
  );
};

const FoldableNode = ({
  node,
  pickedAddress,
}: {
  node: Extract<OpTreeNode, { kind: 'group' | 'choices' }>;
  pickedAddress: OpAddress | null;
}) => {
  const isPicked = pickedAddress !== null && isOnPath(node.address, pickedAddress);
  const [isOpen, setIsOpen] = useState(isPicked);
  const key = nodeKey(node);
  const count = closedCountLabel(node);

  return (
    <Collapsible.Root open={isOpen} onOpenChange={setIsOpen} className="min-w-0">
      <Collapsible.Trigger
        className={cn(
          'group flex w-full min-w-0 items-baseline gap-1.5 py-0.5 text-left',
          pathClass(isPicked),
        )}
      >
        <PickedMark isPicked={isPicked} />
        <CaretRightIcon
          size={12}
          weight="bold"
          className={cn(
            'relative top-px shrink-0 text-faint transition-transform',
            isOpen && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="shrink-0">{key}</span>
        <span className="min-w-0 truncate font-normal text-muted">{node.description}</span>
        {!isOpen && <span className="shrink-0 font-normal text-muted">{count}</span>}
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {node.kind === 'group' ? (
          <OpNodeList nodes={node.children} pickedAddress={pickedAddress} />
        ) : (
          <ChoiceList
            choices={node.children}
            pickedAddress={pickedAddress}
            pickedChoice={isPicked ? pickedAddress?.choice : undefined}
          />
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
};

const OpNode = ({ node, pickedAddress }: { node: OpTreeNode; pickedAddress: OpAddress | null }) => {
  if (node.kind === 'group' || node.kind === 'choices') {
    return (
      <li className="min-w-0">
        <FoldableNode node={node} pickedAddress={pickedAddress} />
      </li>
    );
  }
  if (node.kind === 'choice') {
    const isPicked = pickedAddress !== null && isOnPath(node.address, pickedAddress);
    return (
      <li className="py-0.5">
        <LeafRow label={node.label} isPicked={isPicked} />
      </li>
    );
  }
  const isPicked = pickedAddress !== null && isOnPath(node.address, pickedAddress);
  return (
    <li className="py-0.5">
      <LeafRow label={nodeKey(node)} description={node.description} isPicked={isPicked} />
    </li>
  );
};

const OpNodeList = ({
  nodes,
  pickedAddress,
}: {
  nodes: OpTreeNode[];
  pickedAddress: OpAddress | null;
}) => (
  <ul className="ms-3 border-l border-line ps-3">
    {nodes.map(node => (
      <OpNode
        key={[...node.address.keys, node.address.choice]
          .filter(part => part !== undefined)
          .join('.')}
        node={node}
        pickedAddress={pickedAddress}
      />
    ))}
  </ul>
);

export const OpTree = ({
  ops,
  pickedAddress,
}: {
  ops: OpTreeNode[];
  pickedAddress: OpAddress | null | undefined;
}) => (
  <section aria-label="Op tree" className="min-w-0">
    <h3 className="pb-2 text-xs font-semibold text-muted">Op tree</h3>
    <ul className="font-mono text-[12px] leading-relaxed">
      {ops.map(node => (
        <OpNode
          key={[...node.address.keys, node.address.choice]
            .filter(part => part !== undefined)
            .join('.')}
          node={node}
          pickedAddress={pickedAddress ?? null}
        />
      ))}
    </ul>
  </section>
);
