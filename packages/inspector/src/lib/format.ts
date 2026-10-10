// How the page writes numbers: one place, so a probability or a duration reads the same in every
// region.

/** A probability as the design shows it: `.64`, and `1` or `0` when certain. */
export const formatProbability = (probability: number): string => {
  if (probability === 1) return '1';
  if (probability === 0) return '0';
  return probability.toFixed(2).replace(/^0/, '');
};

/** A pick's probabilities, one per turn: `1 → .12 → .61`. */
export const formatProbabilities = (probabilities: readonly number[]): string =>
  probabilities.map(formatProbability).join(' → ');

/** Whole milliseconds under a second (`25ms`), else one decimal of seconds (`3.1s`). */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/** A token count, grouped: `2,880`. */
export const formatTokens = (tokens: number): string => tokens.toLocaleString('en-US');

/** A token count in a tight space: `458`, `17.4k`, `50k`. */
export const formatTokensCompact = (tokens: number): string => {
  if (tokens < 1000) return String(tokens);
  return `${Math.round(tokens / 100) / 10}k`;
};
