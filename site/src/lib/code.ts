// The two wiki races, line by line, for the page to set and to draw as silhouettes.
import gutRace from '../../../examples/wikirace.gut.ts?raw';
import plainRace from '../../../examples/wikirace.plain.ts?raw';

export type CodeLine = {
  /** Its line number in the file, from 1. */
  number: number;
  text: string;
  isComment: boolean;
  indent: number;
  length: number;
};

const toLine = (text: string, index: number): CodeLine => ({
  number: index + 1,
  text,
  isComment: text.trimStart().startsWith('//'),
  indent: text.length - text.trimStart().length,
  length: text.trimEnd().length,
});

const toLines = (source: string) => source.trimEnd().split('\n').map(toLine);

export const withGut = toLines(gutRace);
export const withoutGut = toLines(plainRace);

/** The number of the one line of `lines` that matches `pattern`. */
export const lineOf = (lines: CodeLine[], pattern: RegExp) => {
  const [line, ...rest] = lines.filter(({ text }) => pattern.test(text));
  if (line === undefined || rest.length > 0) {
    throw new Error(`${pattern} should match exactly one line of the wiki race`);
  }
  return line.number;
};

/** A run of lines, from `start` to `end` inclusive, by number. */
export type LineRange = { start: number; end: number };

/**
 * The lines a pattern starts. A line that opens a block (ends in `{`) runs to the line at its own
 * indent that closes it, so `context: {` covers the whole object.
 */
export const rangeOf = (lines: CodeLine[], pattern: RegExp): LineRange => {
  const start = lineOf(lines, pattern);
  const first = lines[start - 1];
  if (first === undefined || !first.text.trimEnd().endsWith('{')) return { start, end: start };
  const closing = lines.find(
    line =>
      line.number > start && line.indent === first.indent && line.text.trimStart().startsWith('}'),
  );
  if (closing === undefined) throw new Error(`line ${start} opens a block that never closes`);
  return { start, end: closing.number };
};

/** The wiki race's lines the story turns its scene into: gut's whole shape, line by line. */
export const TASK_LINES = {
  initGut: /= await initGut\(\);/,
  context: /^\s+context: \{/,
  goal: /^\s+goal: /,
  ops: /^\s+ops: \{/,
};

/**
 * The command that runs the wiki race, from its header comment, from gut's own root (the public
 * repo's): `gut run examples/wikirace.gut.ts`.
 */
export const RUN_COMMAND = (() => {
  const path = gutRace.match(/^\/\/ gut run (\S+)/m)?.[1];
  if (path === undefined) throw new Error('the wiki race should say how to run it in its header');
  return `gut run ${path.replace(/^projects\/gut\//, '')}`;
})();
