/** How the options of a question are ordered in the turn view. */
export type OptionSort = 'as-sent' | 'by-probability';

export type SortableOption = {
  /** Stable position as the model saw them; breaks ties when sorting by probability. */
  index: number;
  /**
   * Probability used for sorting. A turn you answered treats the chosen option as 1 and the rest
   * as 0; a model answer uses its reported probabilities (missing keys as 0).
   */
  probability: number;
};

/** Reorders options: as the model saw them, or highest probability first. */
export const sortOptions = <T extends SortableOption>(
  options: readonly T[],
  mode: OptionSort,
): T[] => {
  const copy = [...options];
  if (mode === 'as-sent') {
    return copy.sort((a, b) => a.index - b.index);
  }
  return copy.sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return a.index - b.index;
  });
};

/** Options below this fold behind "+N more below .01" when probabilities are shown. */
export const LOW_PROBABILITY = 0.01;

export type FoldableOption = {
  probability: number;
  /** The model's (or your) pick is never folded, even below `.01`. */
  isChosen: boolean;
};

/** One stretch of the option list: a visible row, or a consecutive run folded in place. */
export type OptionSegment<T> = { kind: 'option'; option: T } | { kind: 'fold'; options: T[] };

/**
 * Walks a sorted list and folds each run of consecutive low-probability options *in place*.
 * The chosen option always stays visible, so a list of near-equal tiny probs still shows the pick.
 */
export const foldLowProbabilityRuns = <T extends FoldableOption>(
  options: readonly T[],
): OptionSegment<T>[] => {
  const segments: OptionSegment<T>[] = [];
  let run: T[] = [];

  const flushRun = () => {
    if (run.length === 0) return;
    segments.push({ kind: 'fold', options: run });
    run = [];
  };

  for (const option of options) {
    const folds = option.probability < LOW_PROBABILITY && !option.isChosen;
    if (folds) {
      run.push(option);
      continue;
    }
    flushRun();
    segments.push({ kind: 'option', option });
  }
  flushRun();
  return segments;
};
