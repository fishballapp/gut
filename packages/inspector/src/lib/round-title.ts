import type { OpAddress, OpTreeNode } from '@gut.run/core/inspector';

/**
 * A round's title as parts, read from the op tree at the picked address: a choice is its list's
 * keys and its label; a plain op is the keys above its own key and that key.
 */
export type RoundTitle =
  | { kind: 'choice'; keys: string[]; label: string }
  | { kind: 'op'; prefix: string[]; key: string };

/**
 * The move the round took: its title; what it reads as on its own (an op's description, or a
 * choice's list and label); and the whole path the model read to it.
 */
export type PickedOp = { title: RoundTitle; move: string; description: string };

type Described = Extract<OpTreeNode, { description: string }>;
type Leaf = { node: Extract<OpTreeNode, { kind: 'op' | 'choice' }>; ancestors: Described[] };

const isSameAddress = (a: OpAddress, b: OpAddress): boolean =>
  a.choice === b.choice &&
  a.keys.length === b.keys.length &&
  a.keys.every((key, i) => key === b.keys[i]);

/** Every op and choice in the tree, with the groups and choice lists above it. */
const leavesOf = (nodes: readonly OpTreeNode[], ancestors: Described[] = []): Leaf[] =>
  nodes.flatMap(node => {
    if (node.kind === 'group' || node.kind === 'choices') {
      return leavesOf(node.children, [...ancestors, node]);
    }
    return [{ node, ancestors }];
  });

/** The op or choice at a picked address, with its title and description; null when the tree lacks it. */
export const pickedOp = (ops: readonly OpTreeNode[], address: OpAddress): PickedOp | null => {
  const leaf = leavesOf(ops).find(({ node }) => isSameAddress(node.address, address));
  if (leaf === undefined) return null;
  const { node, ancestors } = leaf;
  if (node.kind === 'choice') {
    const list = ancestors.at(-1);
    return {
      title: { kind: 'choice', keys: node.address.keys, label: node.label },
      move: list === undefined ? node.label : `${list.description} › ${node.label}`,
      description: [...ancestors.map(entry => entry.description), node.label].join(' › '),
    };
  }
  const key = node.address.keys.at(-1);
  if (key === undefined) return null;
  const prefix = node.address.keys.slice(0, -1);
  return {
    title: { kind: 'op', prefix, key },
    move: node.description,
    description: [...ancestors, node].map(entry => entry.description).join(' › '),
  };
};
