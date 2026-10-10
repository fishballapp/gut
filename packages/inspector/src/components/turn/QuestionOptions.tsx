import { RadioGroup } from '@base-ui/react/radio-group';
import { cn } from '@fishballapps/cn';
import { motion, useReducedMotion } from 'motion/react';
import { type Ref, useEffect, useId, useRef } from 'react';
import { GOAL_QUESTION_KEY, keycapOf, LIST_LIMIT } from '../../lib/answer.ts';
import { REORDER_SECONDS } from '../../lib/option-motion.ts';
import { revealWithin } from '../../lib/reveal.ts';
import type { OptionSort } from '../../lib/sort-options.ts';
import type { OptionRowData, OptionsPhase } from '../../lib/turn-display.ts';
import { OptionRow } from './OptionRow.tsx';

/**
 * One question of a turn: its instructions, a filter when the list is long, then its options as
 * they are shown in this phase. The same list serves all three phases, so its rows stay mounted
 * and move when the order changes.
 */
export const QuestionOptions = ({
  questionKey,
  instructions,
  optionCount,
  matchCount,
  query,
  onQuery,
  filterRef,
  onChoose,
  phase,
  chosen,
  sort,
  rows,
  showsProbability,
  isAnsweredByYou,
}: {
  questionKey: string;
  instructions: string;
  optionCount: number;
  matchCount: number;
  query: string;
  onQuery: (query: string) => void;
  filterRef: Ref<HTMLInputElement>;
  onChoose: (optionKey: string) => void;
  phase: OptionsPhase;
  /** The option you picked while choosing, or the one the turn settled on. */
  chosen: string | undefined;
  sort: OptionSort;
  /** Already filtered and sorted: the order the rows show in. */
  rows: readonly OptionRowData[];
  showsProbability: boolean;
  isAnsweredByYou: boolean;
}) => {
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const isGoal = questionKey === GOAL_QUESTION_KEY;
  const isLong = optionCount > LIST_LIMIT;
  const isChoosing = phase === 'choose';
  const reduceMotion = useReducedMotion() === true;

  // Opening the question, or re-sorting it, brings the recorded option into view inside this list,
  // once the rows have moved to their places (their layout is final before the move ends).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs when sort or chosen changes; the body reads the DOM.
  useEffect(() => {
    const timer = setTimeout(
      () => {
        const list = listRef.current;
        const row = list?.querySelector<HTMLElement>('[data-chosen]');
        if (list !== null && list !== undefined && row !== null && row !== undefined) {
          revealWithin(list, row);
        }
      },
      reduceMotion ? 0 : REORDER_SECONDS * 1000,
    );
    return () => clearTimeout(timer);
  }, [sort, chosen]);

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
            <span className="shrink-0">{`${matchCount} of ${optionCount}`}</span>
          )}
          <input
            ref={filterRef}
            type="text"
            value={query}
            onChange={event => onQuery(event.target.value)}
            disabled={phase === 'asking'}
            placeholder="Filter options (/)"
            aria-label={`Filter ${instructions}`}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
        </label>
      )}
      {/* The list scrolls, so it is a layout-scroll container: rows move within it without drifting. */}
      <motion.div
        ref={listRef}
        layoutScroll
        className={cn('relative mt-1 max-h-96 overflow-y-auto', isGoal && 'max-w-xl')}
      >
        <RadioGroup
          aria-labelledby={headingId}
          value={chosen ?? ''}
          onValueChange={onChoose}
          disabled={!isChoosing}
        >
          {rows.map((row, position) => (
            <OptionRow
              key={row.key}
              optionKey={row.key}
              text={row.text}
              kindLabel={row.kindLabel}
              keycap={isChoosing ? keycapOf(questionKey, row.key, position) : undefined}
              index={position}
              phase={phase}
              isChosen={row.key === chosen}
              isAnsweredByYou={isAnsweredByYou}
              probability={row.probability}
              showsProbability={showsProbability}
            />
          ))}
        </RadioGroup>
      </motion.div>
    </section>
  );
};
