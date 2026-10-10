import { Radio } from '@base-ui/react/radio';
import { cn } from '@fishballapps/cn';
import { motion, useReducedMotion } from 'motion/react';
import { formatProbability } from '../../lib/format.ts';
import { REORDER_SECONDS, staggerSeconds } from '../../lib/option-motion.ts';
import type { OptionsPhase } from '../../lib/turn-display.ts';
import { Keycap } from '../run/Keycap.tsx';

/** Split so only the first line of a chosen option gets the highlight mark. */
const splitFirstLine = (text: string): { first: string; rest: string | undefined } => {
  const newline = text.indexOf('\n');
  if (newline === -1) return { first: text, rest: undefined };
  return { first: text.slice(0, newline), rest: text.slice(newline + 1) };
};

/**
 * One option in every phase, so a row keeps its place from waiting, to asked, to answered: the
 * radio column and the probability column are always there, and only their contents change. A row
 * moves to its new place with a layout animation, and its bar grows to the probability.
 */
export const OptionRow = ({
  optionKey,
  text,
  kindLabel,
  keycap,
  index,
  phase,
  isChosen,
  isAnsweredByYou,
  probability,
  showsProbability,
}: {
  optionKey: string;
  text: string;
  kindLabel?: string;
  /** The key that picks this row while you choose; none otherwise. */
  keycap?: string;
  /** Position in the list as shown, so the bars grow with a light stagger. */
  index: number;
  phase: OptionsPhase;
  /** The option the turn settled on (read) or the one you picked (choose). */
  isChosen: boolean;
  isAnsweredByYou: boolean;
  probability: number;
  showsProbability: boolean;
}) => {
  const reduceMotion = useReducedMotion() === true;
  const { first, rest } = splitFirstLine(text);
  const isRecorded = phase === 'read' && isChosen;
  const isChoosing = phase === 'choose';
  const barScale = showsProbability ? Math.min(probability, 1) : 0;
  const barTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1] as const,
        delay: staggerSeconds(index),
      };
  return (
    <motion.div
      layout={reduceMotion ? false : 'position'}
      transition={{ duration: REORDER_SECONDS }}
      data-chosen={isRecorded || undefined}
    >
      <Radio.Root
        value={optionKey}
        className={cn(
          'grid w-full grid-cols-[1rem_3rem_minmax(0,1fr)_3.5rem] items-center gap-x-3 rounded-md border border-transparent px-2.5 py-1.5 text-left outline-none',
          isChoosing &&
            'hover:bg-raised focus-visible:outline-2 focus-visible:outline-ink data-[checked]:border-ink',
          !isChoosing && 'data-[disabled]:cursor-default',
        )}
      >
        <span aria-hidden className="grid size-4 place-items-center">
          {phase !== 'read' && (
            <span className="grid size-4 place-items-center rounded-full border border-muted">
              <Radio.Indicator className="size-2 rounded-full bg-ink" />
            </span>
          )}
        </span>
        <span className="font-mono text-[11px] text-muted">{optionKey}</span>
        <span className="min-w-0">
          <span className="block whitespace-pre-wrap font-mono text-[13px] leading-snug">
            {isRecorded ? (
              <span className="bg-highlight px-0.5 text-on-highlight">{first}</span>
            ) : (
              <span className="text-ink">{first}</span>
            )}
            {kindLabel !== undefined && (
              <span className="ml-2 font-sans text-[11px] text-muted">{kindLabel}</span>
            )}
            {isAnsweredByYou && isRecorded && (
              <span className="ml-2 rounded-[3px] bg-ink px-1.5 py-px font-sans text-[11px] font-medium leading-4 text-ground">
                you
              </span>
            )}
            {isRecorded && <span className="sr-only">chosen</span>}
            {rest !== undefined && <span className="text-ink">{`\n${rest}`}</span>}
          </span>
          <span
            className={cn(
              'mt-1 block h-0.5 overflow-hidden rounded-full bg-track',
              !showsProbability && 'invisible',
            )}
          >
            <motion.span
              className={cn('block h-full rounded-full', isRecorded ? 'bg-chosen' : 'bg-bar')}
              style={{ originX: 0 }}
              initial={false}
              animate={{ scaleX: barScale }}
              transition={barTransition}
            />
          </span>
        </span>
        <span className="justify-self-end font-mono text-[13px] tabular-nums">
          {showsProbability && (
            <span className={isRecorded ? 'text-chosen' : 'text-muted'}>
              {formatProbability(probability)}
            </span>
          )}
          {keycap !== undefined && <Keycap>{keycap}</Keycap>}
        </span>
      </Radio.Root>
    </motion.div>
  );
};
