// Checks the developer's edits against a round's op tree before they are held for a re-pick. Core
// applies whatever it is given, so an edit at an address the round does not have must fail here.
import type { Edit, OpAddress, OpTreeNode } from '@gut.run/core/inspector';

type OpEdit = Exclude<Edit, { kind: 'context' }>;

const sameAddress = (a: OpAddress, b: OpAddress): boolean =>
  a.choice === b.choice &&
  a.keys.length === b.keys.length &&
  a.keys.every((key, i) => key === b.keys[i]);

const flatten = (nodes: readonly OpTreeNode[]): OpTreeNode[] =>
  nodes.flatMap(node => [
    node,
    ...(node.kind === 'group' || node.kind === 'choices' ? flatten(node.children) : []),
  ]);

const pathOf = ({ keys, choice }: OpAddress): string =>
  choice === undefined ? keys.join('.') : `${keys.join('.')}[${choice}]`;

const addressOf = (edit: OpEdit): OpAddress => {
  if (edit.kind === 'hide') return edit.address;
  if (edit.kind === 'label') return { keys: edit.keys, choice: edit.choice };
  return { keys: edit.keys };
};

/** Names an edit for the page, in the same path form the op tree shows. */
const nameOf = (edit: Edit): string => {
  if (edit.kind === 'context') return 'context';
  if (edit.kind === 'hide') return `hide ${pathOf(edit.address)}`;
  if (edit.kind === 'label') return `label of ${pathOf(addressOf(edit))}`;
  return `description of ${pathOf(edit)}`;
};

const problemOf = (nodes: readonly OpTreeNode[], edit: Edit): string | undefined => {
  if (edit.kind === 'context') return undefined;
  const name = nameOf(edit);
  const node = nodes.find(candidate => sameAddress(candidate.address, addressOf(edit)));
  if (edit.kind === 'label') {
    return node?.kind === 'choice' ? undefined : `${name}: no choice there in this round`;
  }
  if (node === undefined) return `${name}: nothing there in this round`;
  return undefined;
};

/** The first edit the round's op tree cannot take, named for the page; undefined when all can. */
export const editProblem = (
  ops: readonly OpTreeNode[],
  edits: readonly Edit[],
): string | undefined => {
  const nodes = flatten(ops);
  for (const edit of edits) {
    const problem = problemOf(nodes, edit);
    if (problem !== undefined) return problem;
  }
  return undefined;
};
