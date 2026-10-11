// What the round panel says: a note under its title, and how the op tree labels each node.
import type { OpTreeNode } from '@gut.run/core/inspector';
import type { Round, Run } from '../state/inspector-state.ts';

/** Leaf moves under a node: one per op or choice; groups sum their children. */
export const countMoves = (node: OpTreeNode): number => {
  switch (node.kind) {
    case 'op':
    case 'choice':
      return 1;
    case 'choices':
      return node.children.length;
    case 'group':
      return node.children.reduce((sum, child) => sum + countMoves(child), 0);
  }
};

/** What a foldable node holds, beside its text: `(9 moves)` for a group, `(12 choices)` for an op's list. */
export const countLabel = (node: Extract<OpTreeNode, { kind: 'group' | 'choices' }>): string => {
  const n = node.kind === 'choices' ? node.children.length : countMoves(node);
  const noun = node.kind === 'choices' ? 'choice' : 'move';
  return `(${n.toLocaleString('en-US')} ${n === 1 ? noun : `${noun}s`})`;
};

/** The kind a node is, as the op tree tags it; a choice sits under its op and needs no tag. */
export const nodeTag = (node: OpTreeNode): 'Group' | 'Op' | undefined => {
  switch (node.kind) {
    case 'group':
      return 'Group';
    case 'op':
    case 'choices':
      return 'Op';
    case 'choice':
      return undefined;
  }
};

/** The one line under the round's title, when there is something to say: its step failed, or its goal was met. */
export type RoundNote = { kind: 'error'; text: string } | { kind: 'goal'; text: string };

export const roundNote = (round: Round, run: Run | undefined): RoundNote | undefined => {
  if (round.invoked?.error !== undefined) return { kind: 'error', text: round.invoked.error };
  if (round.picked?.address === null) return { kind: 'goal', text: 'Goal achieved' };
  if (round.picked === undefined && round.goalChecked?.achieved === true) {
    const text =
      run?.isGoalCheckedInCode === true ? 'Goal achieved, checked in code' : 'Goal achieved';
    return { kind: 'goal', text };
  }
  return undefined;
};
