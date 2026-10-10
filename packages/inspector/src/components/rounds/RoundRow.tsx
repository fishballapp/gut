import { Tooltip } from '@base-ui/react/tooltip';
import type { Ref } from 'react';
import {
  type PickedOp,
  type RoundHeadline,
  type RoundTitle,
  roundHeadline,
  roundProbability,
} from '../../lib/round-title.ts';
import type { Round } from '../../state/inspector-state.ts';

/** A title's parts inline: the keys dim, the label semibold. The caller decides how it wraps. */
const TitleText = ({ title }: { title: RoundTitle }) => {
  if (title.kind === 'choice') {
    return (
      <>
        <span className="text-muted">{`${title.keys.join('.')} · `}</span>
        <span className="font-semibold">{title.label}</span>
      </>
    );
  }
  return (
    <>
      {title.prefix.length > 0 && (
        <span className="text-muted">{`${title.prefix.join('.')}.`}</span>
      )}
      <span className="font-semibold">{title.key}</span>
    </>
  );
};

/** The row's main line for a title: the choice's label, or the plain op's own key. */
const mainText = (title: RoundTitle): string => (title.kind === 'choice' ? title.label : title.key);

const MainLine = ({ headline }: { headline: RoundHeadline }) => {
  switch (headline.kind) {
    case 'your-turn':
      return <span className="truncate font-semibold text-you">Your turn</span>;
    case 'goal':
      return <span className="truncate">goal achieved</span>;
    case 'pending':
      return <span className="text-muted">…</span>;
    case 'step':
      return <span className="truncate font-mono text-[13px] text-muted">{headline.step}</span>;
    case 'title':
      return (
        <span className="block truncate font-mono text-[13px] font-semibold text-ink">
          {mainText(headline.picked.title)}
        </span>
      );
  }
};

/** The full move on hover or focus: its title, then what the model read for it. */
const DetailView = ({ picked }: { picked: PickedOp }) => (
  <>
    <span className="block font-mono text-[13px]">
      <TitleText title={picked.title} />
    </span>
    <span className="mt-0.5 block text-muted">{picked.description}</span>
  </>
);

/**
 * One round in the sidebar: its subtitle (where the move sits) over its main line (the move), with
 * the round number and the pick's probability on the main line's baseline. Rows that have no move
 * keep the same height, with an empty subtitle line.
 */
export const RoundRow = ({
  round,
  isYourTurn,
  isSelected,
  ref,
  onSelect,
}: {
  round: Round;
  isYourTurn: boolean;
  isSelected: boolean;
  ref?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}) => {
  const headline = roundHeadline(round, isYourTurn);
  return (
    <Tooltip.Root disabled={headline.kind !== 'title'}>
      <Tooltip.Trigger
        render={
          <button
            ref={ref}
            type="button"
            aria-current={isSelected}
            onClick={onSelect}
            className="grid w-full grid-cols-[3ch_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-baseline gap-x-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-ink aria-current:border-line aria-current:bg-raised"
          />
        }
      >
        <span className="row-start-2 font-mono text-xs text-muted tabular-nums">{round.round}</span>
        <span className="col-start-2 row-start-1 h-4 truncate font-mono text-[11px] text-muted">
          {headline.kind === 'title' ? headline.picked.subtitle : ''}
        </span>
        <span className="col-start-2 row-start-2 min-w-0">
          <MainLine headline={headline} />
        </span>
        <span className="col-start-3 row-start-2 font-mono text-xs text-muted tabular-nums">
          {roundProbability(round)}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={6}>
          <Tooltip.Popup className="max-w-[22rem] rounded-md border border-line bg-raised px-2 py-1 text-[12px] text-ink shadow-sm">
            {headline.kind === 'title' && <DetailView picked={headline.picked} />}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};
