// How fast a decision model answers, as the README states it: the page reads the figure from there,
// never from copy.
import readme from '../../../README.md?raw';

/** The README's median time per request to Jev, in milliseconds. */
export const readMedianMs = (text: string) => {
  const ms = /median of (\d+) ms/.exec(text)?.[1];
  if (ms === undefined) throw new Error('the README should state a median time per request');
  return Number(ms);
};

export const medianMs = readMedianMs(readme);
