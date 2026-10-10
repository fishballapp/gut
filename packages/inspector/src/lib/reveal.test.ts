import { describe, expect, it } from 'vitest';
import { revealedScrollTop } from './reveal.ts';

const list = { viewHeight: 400, contentHeight: 2000 };

describe('revealedScrollTop', () => {
  it('centres a row that is below the view', () => {
    expect(revealedScrollTop({ ...list, rowTop: 1500, rowHeight: 30 })).toBe(1500 - 185);
  });

  it('keeps the top of a list at the top, rather than scrolling above it', () => {
    expect(revealedScrollTop({ ...list, rowTop: 10, rowHeight: 30 })).toBe(0);
  });

  it('stops at the bottom, so the last row is not pushed past the end', () => {
    expect(revealedScrollTop({ ...list, rowTop: 1990, rowHeight: 30 })).toBe(1600);
  });

  it('does not scroll a list that fits', () => {
    expect(
      revealedScrollTop({ viewHeight: 400, contentHeight: 300, rowTop: 200, rowHeight: 30 }),
    ).toBe(0);
  });
});
