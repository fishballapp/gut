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
