import { Tooltip } from '@base-ui/react/tooltip';
import { cn } from '@fishballapps/cn';
import type { ReactNode, RefObject } from 'react';
import type { CurrentState } from '../../lib/current-turn.ts';
import { roundEdits } from '../../lib/edit-draft.ts';
import { roundOutcome, type Tone, turnCount, turnTip } from '../../lib/rail-tips.ts';
import type { Round, Turn } from '../../state/inspector-state.ts';

const toneClass = (tone: Tone) => (tone === 'you' ? 'text-you' : 'text-ink');

/** The rail's hover card, beside the row it is about, so it never covers the row's own blocks. */
export const RailTip = ({
  row,
  children,
}: {
  row: RefObject<HTMLLIElement | null>;
  children: ReactNode;
}) => (
  <Tooltip.Portal>
    <Tooltip.Positioner anchor={row} side="right" align="start" sideOffset={14}>
      <Tooltip.Popup className="w-max max-w-[20rem] rounded-md border border-line bg-raised px-2.5 py-2 text-[12px] leading-snug text-ink shadow-sm">
        {children}
      </Tooltip.Popup>
    </Tooltip.Positioner>
  </Tooltip.Portal>
);

/** A round on hover: its number, how many turns (and whether you edited it), and what it did. */
export const RoundTipContent = ({
  round,
  state,
}: {
  round: Round;
  state: CurrentState | undefined;
}) => {
  const outcome = roundOutcome(round, state);
  return (
    <>
      <p className="font-medium">Round {round.round}</p>
      <p className="text-muted">
        {turnCount(round)}
        {roundEdits(round).length > 0 && ' · with your edits'}
      </p>
      {outcome !== undefined && (
        <p className={cn('mt-1', toneClass(outcome.tone))}>
          {outcome.label}
          {outcome.move !== undefined && (
            <>
              {': '}
              <span className="font-mono [overflow-wrap:anywhere]">{outcome.move}</span>
            </>
          )}
        </p>
      )}
    </>
  );
};

/** A turn on hover: where it stands, or each question and the answer it got. */
export const TurnTipContent = ({
  turn,
  state,
}: {
  turn: Turn;
  state: CurrentState | undefined;
}) => {
  const tip = turnTip(turn, state);
  return (
    <>
      <p className="font-medium">Turn {turn.turn}</p>
      {tip.kind === 'status' ? (
        <p className={toneClass(tip.tone)}>{tip.text}</p>
      ) : (
        <ol className="mt-1 space-y-1.5">
          {tip.answers.map((line, index) => (
            <li key={line.question} className="min-w-0">
              <p className="truncate text-muted">{`Q${index + 1}. ${line.question}`}</p>
              <p className="truncate font-mono">{line.answer}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
};
