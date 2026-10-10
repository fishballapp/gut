import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { cn } from '@fishballapps/cn';
import { type Ref, useId } from 'react';
import { GOAL_QUESTION_KEY, keycapOf, LIST_LIMIT, type ListView } from '../../lib/answer.ts';
import { Keycap } from '../run/Keycap.tsx';

/**
 * One question of a turn you answer: for a long list a filter line on top, then every option as a
 * radio in a scrolling list, the chosen one ringed. The keys are the answer form's; this only shows them.
 */
export const AnswerQuestion = ({
  questionKey,
  instructions,
  optionCount,
  view,
  chosen,
  query,
  onChoose,
  onQuery,
  filterRef,
}: {
  questionKey: string;
  instructions: string;
  optionCount: number;
  view: ListView;
  chosen: string | undefined;
  query: string;
  onChoose: (optionKey: string) => void;
  onQuery: (query: string) => void;
  filterRef: Ref<HTMLInputElement>;
}) => {
  const headingId = useId();
  const isGoal = questionKey === GOAL_QUESTION_KEY;
  const isLong = optionCount > LIST_LIMIT;
  return (
    <section className={cn(isGoal ? 'mt-4' : 'mt-6')}>
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id={headingId}
          className={cn(
            'font-medium tracking-tight text-ink',
            isGoal ? 'text-[13px]' : 'text-[15px]',
          )}
        >
          {instructions}
        </h3>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          {optionCount} {optionCount === 1 ? 'option' : 'options'}
        </span>
      </div>
      {isLong && (
        <label className="mt-2 flex items-center gap-2 border-b border-line py-1.5 font-mono text-xs text-muted focus-within:border-ink focus-within:text-ink">
          {query.trim() !== '' && (
            <span className="shrink-0">{`${view.matchCount} of ${optionCount}`}</span>
          )}
          <input
            ref={filterRef}
            type="text"
            value={query}
            onChange={event => onQuery(event.target.value)}
            placeholder="Filter options (/)"
            aria-label={`Filter ${instructions}`}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          />
        </label>
      )}
      <RadioGroup
        aria-labelledby={headingId}
        value={chosen ?? ''}
        onValueChange={onChoose}
        className={cn('mt-1 max-h-96 overflow-y-auto', isGoal && 'max-w-xl')}
      >
        {view.shown.map((option, index) => {
          const keycap = keycapOf(questionKey, option.key, index);
          return (
            <Radio.Root
              key={option.key}
              value={option.key}
              className="grid w-full grid-cols-[1rem_4.5rem_minmax(0,1fr)_1.5rem] items-center gap-x-3 rounded-md border border-transparent px-2.5 py-1.5 text-left outline-none hover:bg-raised focus-visible:outline-2 focus-visible:outline-ink data-[checked]:border-ink"
            >
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full border border-muted"
              >
                <Radio.Indicator className="size-2 rounded-full bg-ink" />
              </span>
              <span className="font-mono text-[11px] text-muted">{option.key}</span>
              <span className="min-w-0 whitespace-pre-wrap font-mono text-[13px] leading-snug text-ink">
                {option.text}
              </span>
              <span className="justify-self-end">
                {keycap !== undefined && <Keycap>{keycap}</Keycap>}
              </span>
            </Radio.Root>
          );
        })}
      </RadioGroup>
    </section>
  );
};
