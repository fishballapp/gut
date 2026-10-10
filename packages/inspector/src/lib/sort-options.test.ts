import { describe, expect, it } from 'vitest';
import { sortOptions } from './sort-options.ts';

const opts = (rows: { key: string; index: number; probability: number }[]) => rows;

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
