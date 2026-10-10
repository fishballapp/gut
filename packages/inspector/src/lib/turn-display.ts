import type { OptionInfo } from '@gut.run/core/inspector';
import type { Round, Turn } from '../state/inspector-state.ts';
import { formatDuration, formatTokens } from './format.ts';

/** A muted label for what the option is; moves show nothing. */
export const optionKindLabel = (info: OptionInfo | undefined): string | undefined => {
  if (info === undefined) return undefined;
  switch (info.kind) {
    case 'move':
      return undefined;
    case 'group':
      return `group · ${info.moves} moves`;
    case 'choices':
      return `choices · ${info.moves}`;
    case 'bundle':
      return info.size === undefined ? 'bundle' : `bundle · ${info.size}`;
    case 'back':
      return 'go back';
  }
};

/** One retry line above the options: `503 · retried after 1.0s`. */
export const formatRetry = (retry: Turn['retries'][number]): string => {
  const what =
    retry.status !== undefined ? String(retry.status) : (retry.error ?? 'request failed');
  return `${what} · retried after ${formatDuration(retry.delayMs)}`;
};

/** Whether this turn belongs to a pick the round later abandoned. */
export const isAbandonedPick = (round: Round, turn: Turn): boolean =>
  turn.pick !== Math.max(round.picks.length, 1);

/** Right-side status of the turn header. */
export const turnStatusLabel = (turn: Turn): string => {
  const { outcome } = turn;
  switch (outcome.status) {
    case 'asked':
      return 'waiting';
    case 'failed':
      return 'failed';
    case 'dropped':
      return outcome.reason === 'repick' ? 'dropped by a re-pick' : 'dropped: the budget ran out';
    case 'answered': {
      const duration = formatDuration(outcome.ms);
      if (outcome.by.kind === 'you') return `answered by you · ${duration}`;
      return `answered by ${outcome.by.name} · ${formatTokens(outcome.inputTokens)} tokens · ${duration}`;
    }
  }
};

/** Whether this turn was answered by the developer (no probabilities shown). */
export const isAnsweredByYou = (turn: Turn): boolean =>
  turn.outcome.status === 'answered' && turn.outcome.by.kind === 'you';

/** Whether probabilities and bars should render for this turn. */
export const showsProbabilities = (turn: Turn): boolean =>
  turn.outcome.status === 'answered' && turn.outcome.by.kind === 'model';

/** The chosen criterion key for a question, when the turn has an answer. */
export const chosenKey = (turn: Turn, questionKey: string): string | undefined => {
  if (turn.outcome.status !== 'answered') return undefined;
  return turn.outcome.answers[questionKey]?.choice;
};

/** Probability used for sorting and folding one option of a question. */
export const optionProbability = (
  turn: Turn,
  questionKey: string,
  criterionKey: string,
): number => {
  if (turn.outcome.status === 'answered' && turn.outcome.by.kind === 'you') {
    return turn.outcome.answers[questionKey]?.choice === criterionKey ? 1 : 0;
  }
  if (turn.outcome.status !== 'answered') return 0;
  return turn.outcome.answers[questionKey]?.probabilities[criterionKey] ?? 0;
};
