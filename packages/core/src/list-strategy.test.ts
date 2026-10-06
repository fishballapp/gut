import { describe, expect, it } from 'vitest';
import { ListStrategy, type Questions } from './list-strategy.ts';

const items = Array.from({ length: 1000 }, (_, i) => ({ description: `item ${i}` }));

// A model that takes up to `maxOptions` options and wants item 742: it picks the option naming it,
// else the first.
const questionsFor = (maxOptions: number, asked: number[]): Questions => ({
  maxOptions,
  ask: async options => {
    asked.push(options.length);
    const [first] = options;
    if (first === undefined) throw new Error('no options');
    return options.find(option => option.description.split(/: |, /).includes('item 742')) ?? first;
  },
});

describe.each([
  ['bundle', ListStrategy.bundle],
  ['knockout', ListStrategy.knockout],
])('%s', (_, strategy) => {
  it.each([26, 5])(
    'finds the wanted item, never asking more than the model takes (%i)',
    async maxOptions => {
      const asked: number[] = [];
      const chosen = await strategy(items, questionsFor(maxOptions, asked));
      expect(chosen).toEqual({ description: 'item 742' });
      expect(Math.max(...asked)).toBe(maxOptions);
    },
  );
});
