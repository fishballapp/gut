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
