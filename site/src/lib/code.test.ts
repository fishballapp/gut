import { describe, expect, it } from 'vitest';
import { lineOf, RUN_COMMAND, rangeOf, TASK_LINES, withGut } from './code.ts';

// The page marks these lines of the wiki race; editing the file must keep each one findable.
describe('the marked lines of the wiki race', () => {
  it.each(Object.entries(TASK_LINES))('finds exactly one line for %s', (_name, pattern) => {
    expect(withGut[lineOf(withGut, pattern) - 1]?.text).toMatch(pattern);
  });

  it('fails on a pattern no line matches', () => {
    expect(() => lineOf(withGut, /no such line/)).toThrow(/exactly one line/);
  });

  it('runs a line that opens a block to the line that closes it', () => {
    const { start, end } = rangeOf(withGut, TASK_LINES.ops);
    expect(withGut[start - 1]?.text.trim()).toBe('ops: {');
    expect(withGut[end - 1]?.text.trim()).toBe('},');
  });

  it('keeps a line that opens no block to itself', () => {
    const { start, end } = rangeOf(withGut, TASK_LINES.goal);
    expect(end).toBe(start);
  });
});

describe('the wiki race', () => {
  // The model judges the goal from context.goal; the story says so.
  it('leaves the goal to the model', () => {
    expect(withGut.some(({ text }) => text.includes('isGoalAchieved'))).toBe(false);
  });
});

describe('running the wiki race', () => {
  it("is the command in its header, from gut's root", () => {
    expect(RUN_COMMAND).toBe('gut run examples/wikirace.gut.ts');
  });
});
