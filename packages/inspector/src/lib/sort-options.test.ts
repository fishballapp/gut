import { describe, expect, it } from 'vitest';
import { foldLowProbabilityRuns, sortOptions } from './sort-options.ts';

const opts = (rows: { key: string; index: number; probability: number; isChosen?: boolean }[]) =>
  rows.map(row => ({ isChosen: false, ...row }));

const keysOf = (
  segments: ReturnType<
    typeof foldLowProbabilityRuns<{ key: string } & { probability: number; isChosen: boolean }>
  >,
) =>
  segments.map(segment => {
    if (segment.kind === 'option') return segment.option.key;
    return `fold:${segment.options.map(o => o.key).join(',')}`;
  });

describe('sortOptions', () => {
  it('keeps as-sent order by index', () => {
    const sorted = sortOptions(
      opts([
        { key: 'o3', index: 2, probability: 0.9 },
        { key: 'o1', index: 0, probability: 0.1 },
        { key: 'o2', index: 1, probability: 0.5 },
      ]),
      'as-sent',
    );
    expect(sorted.map(o => o.key)).toEqual(['o1', 'o2', 'o3']);
  });

  it('orders by probability descending, then index', () => {
    const sorted = sortOptions(
      opts([
        { key: 'o1', index: 0, probability: 0.2 },
        { key: 'o2', index: 1, probability: 0.5 },
        { key: 'o3', index: 2, probability: 0.5 },
        { key: 'o4', index: 3, probability: 0.1 },
      ]),
      'by-probability',
    );
    expect(sorted.map(o => o.key)).toEqual(['o2', 'o3', 'o1', 'o4']);
  });

  it('puts a you-pick (probability 1) first when sorting by probability', () => {
    const sorted = sortOptions(
      opts([
        { key: 'o1', index: 0, probability: 0 },
        { key: 'o2', index: 1, probability: 1 },
        { key: 'o3', index: 2, probability: 0 },
      ]),
      'by-probability',
    );
    expect(sorted.map(o => o.key)).toEqual(['o2', 'o1', 'o3']);
  });

  it('does not mutate the input', () => {
    const input = opts([
      { key: 'o2', index: 1, probability: 0.2 },
      { key: 'o1', index: 0, probability: 0.8 },
    ]);
    sortOptions(input, 'by-probability');
    expect(input.map(o => o.key)).toEqual(['o2', 'o1']);
  });
});

describe('foldLowProbabilityRuns', () => {
  it('folds consecutive low options in place, preserving as-sent order when expanded', () => {
    // sent o1=.005, o2=.8, o3=.195 → fold o1 where it sits, then o2, o3
    const sorted = sortOptions(
      opts([
        { key: 'o1', index: 0, probability: 0.005 },
        { key: 'o2', index: 1, probability: 0.8 },
        { key: 'o3', index: 2, probability: 0.195 },
      ]),
      'as-sent',
    );
    expect(keysOf(foldLowProbabilityRuns(sorted))).toEqual(['fold:o1', 'o2', 'o3']);
  });

  it('keeps the chosen option visible even when it is below .01', () => {
    const options = opts(
      Array.from({ length: 5 }, (_, i) => ({
        key: `o${i + 1}`,
        index: i,
        probability: 0.004,
        isChosen: i === 2,
      })),
    );
    expect(keysOf(foldLowProbabilityRuns(options))).toEqual(['fold:o1,o2', 'o3', 'fold:o4,o5']);
  });

  it('folds trailing lows after a by-probability sort without reordering the list', () => {
    const sorted = sortOptions(
      opts([
        { key: 'o1', index: 0, probability: 0.005 },
        { key: 'o2', index: 1, probability: 0.8 },
        { key: 'o3', index: 2, probability: 0.195 },
        { key: 'o4', index: 3, probability: 0.001, isChosen: true },
      ]),
      'by-probability',
    );
    expect(sorted.map(o => o.key)).toEqual(['o2', 'o3', 'o1', 'o4']);
    expect(keysOf(foldLowProbabilityRuns(sorted))).toEqual(['o2', 'o3', 'fold:o1', 'o4']);
  });

  it('does not fold options at or above .01', () => {
    expect(
      keysOf(
        foldLowProbabilityRuns(
          opts([
            { key: 'a', index: 0, probability: 0.5 },
            { key: 'b', index: 1, probability: 0.01 },
            { key: 'c', index: 2, probability: 0.009 },
          ]),
        ),
      ),
    ).toEqual(['a', 'b', 'fold:c']);
  });
});
