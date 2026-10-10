import type { OpAddress, OpTreeNode } from '@gut.run/core/inspector';
import type { Round } from '../state/inspector-state.ts';
import { formatProbability } from './format.ts';
import { isPickedByYou } from './turn-display.ts';

/**
 * A round's title as parts, read from the op tree at the picked address: a choice is its list's
 * keys and its label; a plain op is the keys above its own key and that key.
 */
export type RoundTitle =
  | { kind: 'choice'; keys: string[]; label: string }
  | { kind: 'op'; prefix: string[]; key: string };

/**
 * The move the round took: its title; a subtitle naming where it sits (the list's keys for a choice,
 * the groups above an op, or the op's own description at the top level); and what the model read.
 */
export type PickedOp = { title: RoundTitle; subtitle: string; description: string };

export type RoundHeadline =
  | { kind: 'goal' }
  | { kind: 'pending' }
  | { kind: 'title'; picked: PickedOp }
  /** The address is not in the op tree; the step's own text stands in. */
  | { kind: 'step'; step: string };

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
    return {
      title: { kind: 'choice', keys: node.address.keys, label: node.label },
      subtitle: node.address.keys.join('.'),
      description: [...ancestors.map(entry => entry.description), node.label].join(' › '),
    };
  }
  const key = node.address.keys.at(-1);
  if (key === undefined) return null;
  const prefix = node.address.keys.slice(0, -1);
  return {
    title: { kind: 'op', prefix, key },
    subtitle: prefix.length > 0 ? prefix.join('.') : node.description,
    description: [...ancestors, node].map(entry => entry.description).join(' › '),
  };
};

/** What a round row says in place of its number: the picked move's title, or `…` while nothing is picked. */
export const roundHeadline = (round: Round): RoundHeadline => {
  const { picked } = round;
  if (picked === undefined) {
    return round.goalChecked?.achieved === true ? { kind: 'goal' } : { kind: 'pending' };
  }
  // A goal step has no address: the pick met the goal rather than moving toward it.
  if (picked.address === null) return { kind: 'goal' };
  const op = pickedOp(round.ops, picked.address);
  if (op === null) return { kind: 'step', step: picked.step };
  return { kind: 'title', picked: op };
};

/**
 * The pick's last probability, the one of the move the round took: `.64`; `you` when you answered
 * its turns; `—` when nothing was picked.
 */
export const roundProbability = (round: Round): string => {
  const last = round.picked?.probabilities.at(-1);
  if (last === undefined) return '—';
  return isPickedByYou(round) ? 'you' : formatProbability(last);
};
