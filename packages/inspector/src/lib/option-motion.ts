// How long a reorder takes and how the bars start, shared by the rows and the list that scrolls them.

/** A row's move to its new place, and a bar's grow to its probability. */
export const REORDER_SECONDS = 0.5;

/** The first rows start their bars one after another; the rest start with the last of them. */
const STAGGERED_ROWS = 10;
const STAGGER_STEP_SECONDS = 0.03;

/** The delay before a row's bar starts: capped, so a list of 255 options is not a 7-second wait. */
export const staggerSeconds = (index: number): number =>
  Math.min(index, STAGGERED_ROWS) * STAGGER_STEP_SECONDS;
