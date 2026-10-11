import { describe, expect, it } from 'vitest';
import { lineDiff } from './line-diff.ts';

describe('lineDiff', () => {
  it('keeps the lines both sides share', () => {
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ]);
  });

  it('reads a changed line as removed then added', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('reads an added line and a removed one at the end', () => {
    expect(lineDiff('a', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'added', text: 'b' },
    ]);
    expect(lineDiff('a\nb', 'a')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
    ]);
  });
});

describe('lineDiff on large contexts', () => {
  const lines = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n');

  it('diffs ten thousand lines quickly, with one change', () => {
    const before = lines(10_000, 'k');
    const after = before.replace('k5000', 'changed');
    const start = performance.now();
    const diff = lineDiff(before, after);
    expect(performance.now() - start).toBeLessThan(500);
    expect(diff.filter(line => line.kind !== 'same')).toEqual([
      { kind: 'removed', text: 'k5000' },
      { kind: 'added', text: 'changed' },
    ]);
  });

  it('reads a middle too large for the table as removed, then added, keeping the trimmed ends', () => {
    const before = `head\n${lines(1_100, 'old')}\ntail`;
    const after = `head\n${lines(1_100, 'new')}\ntail`;
    const diff = lineDiff(before, after);
    expect(diff[0]).toEqual({ kind: 'same', text: 'head' });
    expect(diff.at(-1)).toEqual({ kind: 'same', text: 'tail' });
    expect(diff.filter(line => line.kind === 'removed')).toHaveLength(1_100);
    expect(diff.filter(line => line.kind === 'added')).toHaveLength(1_100);
    expect(diff.findIndex(line => line.kind === 'added')).toBe(1 + 1_100);
  });

  it('trims a common prefix and suffix before diffing the middle', () => {
    expect(lineDiff('a\nb\nc\nd', 'a\nx\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'x' },
      { kind: 'same', text: 'c' },
      { kind: 'same', text: 'd' },
    ]);
  });
});
