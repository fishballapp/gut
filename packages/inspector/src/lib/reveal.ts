// Scrolling one list so a row in it shows, without moving the page around it.

/**
 * The scrollTop that puts a row in the middle of its list, clamped to the list's ends. Measured in
 * the list's own coordinates, so only the list moves.
 */
export const revealedScrollTop = ({
  rowTop,
  rowHeight,
  viewHeight,
  contentHeight,
}: {
  rowTop: number;
  rowHeight: number;
  viewHeight: number;
  contentHeight: number;
}): number => {
  const centred = rowTop - (viewHeight - rowHeight) / 2;
  return Math.min(Math.max(centred, 0), Math.max(contentHeight - viewHeight, 0));
};

/**
 * Scrolls `list` alone so `row` shows. The list must be the row's offsetParent (`relative`), so the
 * row's offset is measured from the list's top.
 */
export const revealWithin = (list: HTMLElement, row: HTMLElement): void => {
  list.scrollTop = revealedScrollTop({
    rowTop: row.offsetTop,
    rowHeight: row.offsetHeight,
    viewHeight: list.clientHeight,
    contentHeight: list.scrollHeight,
  });
};

/** How far a frame must move so that `start`..`end` shows, moving the least; 0 when it already does. */
const shiftToShow = (start: number, end: number, frameStart: number, frameEnd: number): number => {
  if (start < frameStart) return start - frameStart;
  if (end > frameEnd) return end - frameEnd;
  return 0;
};

/**
 * Scrolls `container` alone, the least that shows `item` on each axis, as `scrollIntoView` with
 * `nearest` would. The page never moves: a container that does not scroll on an axis ignores it.
 */
export const revealNearest = (container: HTMLElement, item: HTMLElement): void => {
  const frame = container.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  container.scrollTop += shiftToShow(box.top, box.bottom, frame.top, frame.bottom);
  container.scrollLeft += shiftToShow(box.left, box.right, frame.left, frame.right);
};
