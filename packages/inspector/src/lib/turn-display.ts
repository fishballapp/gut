import type { OptionInfo } from '@gut.run/core/inspector';
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import { formatDuration, formatTokens } from './format.ts';
import type { OptionSort } from './sort-options.ts';

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

/**
 * Whether you answered any turn of the round's current pick. Your answer carries probability 1, so
 * such a pick shows who chose it rather than a certainty nobody claimed.
 */
export const isPickedByYou = (round: Round): boolean =>
  round.turns.some(turn => turn.outcome.status === 'answered' && turn.outcome.by.kind === 'you');

/** Right-side status of the turn header. */
export const turnStatusLabel = (turn: Turn): string => {
  const { outcome, suggestion } = turn;
  switch (outcome.status) {
    case 'asked':
      if (suggestion === undefined) return 'waiting';
      return `suggested by ${suggestion.by.name} · ${formatTokens(suggestion.inputTokens)} tokens · ${formatDuration(suggestion.ms)}`;
    case 'failed':
      return 'failed';
    case 'dropped':
      return 'dropped: the budget ran out';
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

/**
 * How a turn's options open: by probability when the model answered it, where the ranking is the
 * point; as sent otherwise (a turn you answer, or one still waiting).
 */
export const defaultSortFor = (turn: Turn | undefined): OptionSort =>
  turn !== undefined && showsProbabilities(turn) ? 'by-probability' : 'as-sent';

/** The model's answers a turn shows: the model's own answer, else the one it suggested, which waits for you. */
export const modelAnswersOf = (turn: Turn) => {
  if (turn.outcome.status === 'answered' && turn.outcome.by.kind === 'model') {
    return turn.outcome.answers;
  }
  return turn.suggestion?.answers;
};

/** Whether probabilities and bars should render for this turn: only when the model answered it. */
export const showsProbabilities = (turn: Turn): boolean => modelAnswersOf(turn) !== undefined;

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
  const modelAnswers = modelAnswersOf(turn);
  if (modelAnswers !== undefined) {
    return modelAnswers[questionKey]?.probabilities[criterionKey] ?? 0;
  }
  if (turn.outcome.status === 'answered') {
    return turn.outcome.answers[questionKey]?.choice === criterionKey ? 1 : 0;
  }
  return 0;
};

/**
 * Where a turn's options stand: you choose them (a decision waits), you keep or drop the model's
 * answer to them, the model is answering them, or they are read back as the turn settled.
 */
export type OptionsPhase = 'choose' | 'review' | 'asking' | 'read';

export const optionsPhaseOf = (turn: Turn, decision: Decision | undefined): OptionsPhase => {
  if (decision !== undefined) {
    return decision.on.kind === 'turn' && decision.on.isReview ? 'review' : 'choose';
  }
  if (turn.outcome.status === 'asked') return 'asking';
  return 'read';
};

/** One option of a question as the turn sent it, with what its row shows. */
export type OptionRowData = {
  key: string;
  text: string;
  kindLabel?: string;
  /** Position as sent: the stable order until a sort is chosen, and the tie-break for one. */
  index: number;
  probability: number;
};

export const optionRowsOf = (
  turn: Turn,
  questionKey: string,
  question: Turn['request']['questions'][string],
): OptionRowData[] =>
  Object.entries(question.criteria).map(([key, text], index) => ({
    key,
    text,
    kindLabel: optionKindLabel(turn.optionInfo[questionKey]?.[key]),
    index,
    probability: optionProbability(turn, questionKey, key),
  }));
