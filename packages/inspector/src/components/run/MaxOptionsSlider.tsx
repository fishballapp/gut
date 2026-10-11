import { Slider } from '@base-ui/react/slider';
import { Tooltip } from '@base-ui/react/tooltip';
import type { Action } from '@gut.run/core/inspector';
import { useState } from 'react';
import type { ActOutcome } from '../../lib/connection.ts';
import {
  draftForMove,
  maxOptionsSlider,
  type SizeDraft,
  shownSize,
  sizeToSend,
} from '../../lib/max-options.ts';
import { useAction } from '../../lib/use-action.ts';
import type { InspectorState, Run } from '../../state/inspector-state.ts';

/**
 * The options each question offers, for the run's picks. It commits on release, not on every tick, so
 * a drag re-picks once; a waiting pick starts over at the new size.
 */
export const MaxOptionsSlider = ({
  state,
  run,
  act,
}: {
  state: InspectorState;
  run: Run;
  act: (action: Action) => Promise<ActOutcome>;
}) => {
  const { send, error } = useAction(act);
  const hasEnded = state.ended !== undefined;
  const shown = maxOptionsSlider({ chosen: state.maxOptions, model: run.model ?? state.pageModel });
  const [draft, setDraft] = useState<SizeDraft>();
  const value = shownSize(draft, shown.value);

  // The draft goes once its own send settles, whatever the outcome: the thumb then shows what the
  // session reports. A send that was busy (another action still on its way) is dropped the same way.
  const sendSize = async (next: number) => {
    if (next === shown.value) {
      setDraft(undefined);
      return;
    }
    const sending: SizeDraft = { value: next, isSending: true };
    setDraft(sending);
    await send({ type: 'setMaxOptions', maxOptions: next });
    setDraft(current => (current === sending ? undefined : current));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Tooltip.Provider delay={200}>
        <Slider.Root
          value={value}
          min={shown.min}
          max={shown.max}
          disabled={hasEnded}
          onValueChange={next => setDraft(draftForMove(next, shown.value))}
          onValueCommitted={(next, { reason }) => {
            // A key commits on its own release, on the thumb below.
            if (reason !== 'keyboard') void sendSize(next);
          }}
          className="flex items-center gap-2.5 data-disabled:opacity-60"
        >
          <Slider.Label className="text-[12px] font-medium text-muted">Options</Slider.Label>
          <Slider.Control className="flex h-4 w-24 items-center">
            <Slider.Track className="relative h-[3px] w-full rounded-full bg-track">
              <Slider.Indicator className="rounded-full bg-ink" />
              <Tooltip.Root>
                <Tooltip.Trigger
                  render={
                    <Slider.Thumb
                      onKeyUp={() => {
                        const next = sizeToSend(draft);
                        if (next !== undefined) void sendSize(next);
                      }}
                      className="size-3.5 rounded-full border-2 border-ink bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    />
                  }
                />
                <Tooltip.Portal>
                  <Tooltip.Positioner sideOffset={6}>
                    <Tooltip.Popup className="rounded-md border border-line bg-raised px-2 py-1 text-[12px] text-ink shadow-sm">
                      {hasEnded
                        ? 'The task has ended'
                        : 'Options per question. In Step, moving it re-picks this round; in Play, from the next round.'}
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Slider.Track>
          </Slider.Control>
          <Slider.Value className="w-6 text-right font-mono text-[12px] text-ink tabular-nums" />
        </Slider.Root>
      </Tooltip.Provider>
      {error !== undefined && (
        <p role="status" className="max-w-[220px] text-right text-[11px] text-you">
          {error}
        </p>
      )}
    </div>
  );
};
