import type { OptionInfo } from '@gut.run/core/inspector';
import type { Turn } from '../state/inspector-state.ts';
import { formatTokensCompact } from './format.ts';

const phrase = (count: number, one: string, many: string): string | null => {
  if (count === 0) return null;
  return `${count} ${count === 1 ? one : many}`;
};

/**
 * What a move question offers, counted by kind, with the goal question noted: `3 bundles`,
 * `1 group + 4 moves + goal`. Where the moves sit is not said: a question can offer moves from
 * several groups at once.
 */
export const summarizeOptions = (options: readonly OptionInfo[], hasGoal: boolean): string => {
  const ofKind = (kind: OptionInfo['kind']) => options.filter(option => option.kind === kind);
  const parts = [
    phrase(ofKind('bundle').length, 'bundle', 'bundles'),
    phrase(ofKind('group').length, 'group', 'groups'),
    phrase(ofKind('choices').length, 'choice list', 'choice lists'),
    phrase(ofKind('move').length, 'move', 'moves'),
    ofKind('back').length > 0 ? 'go back' : null,
    hasGoal ? 'goal' : null,
  ].filter(part => part !== null);
  return parts.length === 0 ? 'no options' : parts.join(' + ');
};

/** A turn's summary line: its move question's options, then the goal when the turn asks it. */
export const turnSummary = (turn: Turn): string =>
  summarizeOptions(Object.values(turn.optionInfo.next ?? {}), 'achieved' in turn.request.questions);

/** A turn's right-hand text; `isAwaitingYou` is the one state the page marks in coral. */
export type TurnMark = { text: string; isAwaitingYou: boolean };

/**
 * The turn's right-hand mark: the tokens its model used, or why it has none. `isAwaitingYou` is a
 * decision pending on this turn, the only thing coral marks.
 */
export const turnMark = (turn: Turn, { isAwaitingYou }: { isAwaitingYou: boolean }): TurnMark => {
  if (isAwaitingYou) return { text: 'waiting', isAwaitingYou: true };
  const { outcome } = turn;
  switch (outcome.status) {
    case 'asked':
      return { text: '…', isAwaitingYou: false };
    case 'failed':
      return { text: 'failed', isAwaitingYou: false };
    case 'dropped':
      return { text: 'dropped', isAwaitingYou: false };
    case 'answered':
      if (outcome.by.kind === 'you') return { text: 'you', isAwaitingYou: false };
      return { text: formatTokensCompact(outcome.inputTokens), isAwaitingYou: false };
  }
};
