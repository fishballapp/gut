import type { OpTreeNode } from '@gut.run/core/inspector';
import type { Round, Run } from '../state/inspector-state.ts';
import { formatDuration, formatProbabilities, formatTokens } from './format.ts';

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

/** Closed-node count label: moves for a group, choices for a choices list. */
export const closedCountLabel = (
  node: Extract<OpTreeNode, { kind: 'group' | 'choices' }>,
): string => {
  if (node.kind === 'choices') {
    const n = node.children.length;
    return `· ${n.toLocaleString('en-US')} ${n === 1 ? 'choice' : 'choices'}`;
  }
  const n = countMoves(node);
  return `· ${n.toLocaleString('en-US')} ${n === 1 ? 'move' : 'moves'}`;
};

/**
 * Window into a long choices list: the picked choice and its neighbours, or the head when
 * nothing is picked. Lists at or under `limit` show in full (`'all'`).
 */
export const choiceWindow = (
  length: number,
  pickedChoice: number | undefined,
  limit = 12,
): { start: number; end: number } | 'all' => {
  if (length <= limit) return 'all';
  if (pickedChoice === undefined) return { start: 0, end: limit };
  const half = Math.floor((limit - 1) / 2);
  let start = Math.max(0, pickedChoice - half);
  let end = Math.min(length, start + limit);
  start = Math.max(0, end - limit);
  return { start, end };
};

export type RoundSummaryLine =
  | { kind: 'picked'; step: string; probabilities: string; meta: string }
  | { kind: 'goal'; text: string }
  | { kind: 'pending'; text: 'not picked yet' };

/** One muted summary line under "Round N". */
export const roundSummaryLine = (round: Round, run: Run | undefined): RoundSummaryLine => {
  if (round.picked !== undefined && round.picked.address === null) {
    return { kind: 'goal', text: 'goal achieved' };
  }
  if (round.goalChecked?.achieved === true && round.picked === undefined) {
    return {
      kind: 'goal',
      text: run?.isGoalCheckedInCode === true ? 'checked in code: achieved' : 'goal achieved',
    };
  }
  if (round.picked === undefined) {
    return { kind: 'pending', text: 'not picked yet' };
  }
  return {
    kind: 'picked',
    step: round.picked.step,
    probabilities: formatProbabilities(round.picked.probabilities),
    meta: `${formatDuration(round.picked.ms)} · ${formatTokens(round.picked.tokens)} tokens`,
  };
};

/** Abandoned picks that settled on a step before the re-pick. */
export const abandonedPickedSteps = (round: Round): string[] =>
  round.picks.flatMap(pick => {
    if (pick.abandoned === undefined || pick.picked === undefined) return [];
    return [pick.picked.step];
  });
