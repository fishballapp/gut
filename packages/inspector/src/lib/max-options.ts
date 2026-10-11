// The slider's range and value: the question size a pick asks, capped by the model that answers it.
import { effectiveMaxOptions, type ModelInfo, NO_MODEL_MAX_OPTIONS } from '@gut.run/core/inspector';

/** A question takes at least two options: one has nothing to choose between. */
export const MIN_MAX_OPTIONS = 2;

/**
 * Its range is the model's limit, so Ask model can always take the pending question; with no model,
 * the largest question a default model takes.
 */
export const maxOptionsSlider = ({
  chosen,
  model,
}: {
  chosen: number | null;
  model: ModelInfo | null;
}) => {
  const modelMax = model?.maxOptions ?? null;
  return {
    min: MIN_MAX_OPTIONS,
    max: modelMax ?? NO_MODEL_MAX_OPTIONS,
    value: effectiveMaxOptions({ chosen, modelMax }),
  };
};

/**
 * A size the thumb shows before the session has it: a move not yet sent, or one on its way. It is
 * dropped once its send settles, so afterwards the thumb shows only what the session reports.
 */
export type SizeDraft = { value: number; isSending: boolean };

/** The size the thumb shows: the developer's draft if there is one, else the session's. */
export const shownSize = (draft: SizeDraft | undefined, sessionValue: number): number =>
  draft?.value ?? sessionValue;

/** A move to `next`: a draft, or none when it lands on the session's size (nothing to send). */
export const draftForMove = (next: number, sessionValue: number): SizeDraft | undefined =>
  next === sessionValue ? undefined : { value: next, isSending: false };

/** The size a key up should send: a move not yet on its way. */
export const sizeToSend = (draft: SizeDraft | undefined): number | undefined =>
  draft !== undefined && !draft.isSending ? draft.value : undefined;
