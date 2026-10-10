import { cn } from '@fishballapps/cn';
import { useEffect, useRef } from 'react';
import { revealWithin } from '../../lib/reveal.ts';
import { type OptionSort, sortOptions } from '../../lib/sort-options.ts';
import {
  chosenKey,
  isAnsweredByYou,
  optionKindLabel,
  optionProbability,
  showsProbabilities,
} from '../../lib/turn-display.ts';
import type { Turn } from '../../state/inspector-state.ts';
import { OptionRow } from './OptionRow.tsx';

type Question = Turn['request']['questions'][string];

type PreparedOption = {
  key: string;
  text: string;
  kindLabel?: string;
  index: number;
  probability: number;
  isChosen: boolean;
};

const prepareOptions = (turn: Turn, questionKey: string, question: Question): PreparedOption[] => {
  const chosen = chosenKey(turn, questionKey);
  return Object.entries(question.criteria).map(([key, text], index) => ({
    key,
    text,
    kindLabel: optionKindLabel(turn.optionInfo[questionKey]?.[key]),
    index,
    probability: optionProbability(turn, questionKey, key),
    isChosen: chosen === key,
  }));
};

/** One question of the turn: its instructions, then every option as a list that scrolls. */
export const QuestionBlock = ({
  turn,
  questionKey,
  question,
  sort,
}: {
  turn: Turn;
  questionKey: string;
  question: Question;
  sort: OptionSort;
}) => {
  const isGoal = questionKey === 'achieved';
  const answeredByYou = isAnsweredByYou(turn);
  const withProbabilities = showsProbabilities(turn);
  const chosen = chosenKey(turn, questionKey);
  const sorted = sortOptions(prepareOptions(turn, questionKey, question), sort);
  const listRef = useRef<HTMLUListElement>(null);

  // Opening the question, or re-sorting it, brings the chosen option into view inside this list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs when sort, chosen changes; the body reads the DOM.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-chosen]');
    if (list !== null && list !== undefined && row !== null && row !== undefined) {
      revealWithin(list, row);
    }
  }, [sort, chosen]);
  const optionCount = Object.keys(question.criteria).length;

  return (
    <section className={cn(isGoal ? 'mt-4' : 'mt-6')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className={cn(
            'font-medium tracking-tight text-ink',
            isGoal ? 'text-[13px]' : 'text-[15px]',
          )}
        >
          {question.instructions}
        </h3>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          {optionCount} {optionCount === 1 ? 'option' : 'options'}
        </span>
      </div>
      <ul
        ref={listRef}
        className={cn('relative mt-1 max-h-96 overflow-y-auto', isGoal && 'max-w-xl')}
      >
        {sorted.map(option => (
          <OptionRow
            key={option.key}
            optionKey={option.key}
            text={option.text}
            kindLabel={option.kindLabel}
            probability={option.probability}
            isChosen={option.isChosen}
            isAnsweredByYou={answeredByYou}
            showsProbability={withProbabilities}
          />
        ))}
      </ul>
    </section>
  );
};
