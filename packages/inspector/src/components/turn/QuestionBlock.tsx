import { Collapsible } from '@base-ui/react/collapsible';
import { cn } from '@fishballapps/cn';
import { foldLowProbabilityRuns, type OptionSort, sortOptions } from '../../lib/sort-options.ts';
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

const renderOption = (
  option: PreparedOption,
  answeredByYou: boolean,
  withProbabilities: boolean,
) => (
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
);

/** One question of the turn: its instructions, then its options as a list. */
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
  const sorted = sortOptions(prepareOptions(turn, questionKey, question), sort);
  const segments = withProbabilities
    ? foldLowProbabilityRuns(sorted)
    : sorted.map(option => ({ kind: 'option' as const, option }));
  const foldOpenByDefault = turn.outcome.status === 'asked' || answeredByYou;
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
      <ul className={cn('mt-1', isGoal && 'max-w-xl')}>
        {segments.map((segment, i) => {
          if (segment.kind === 'option') {
            return renderOption(segment.option, answeredByYou, withProbabilities);
          }
          return (
            <li key={`fold-${segment.options.map(o => o.key).join('-')}-${i}`} className="py-1">
              <Collapsible.Root defaultOpen={foldOpenByDefault}>
                <Collapsible.Trigger className="font-mono text-xs text-muted hover:text-ink">
                  +{segment.options.length} more below .01
                </Collapsible.Trigger>
                <Collapsible.Panel>
                  <ul>
                    {segment.options.map(option =>
                      renderOption(option, answeredByYou, withProbabilities),
                    )}
                  </ul>
                </Collapsible.Panel>
              </Collapsible.Root>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
