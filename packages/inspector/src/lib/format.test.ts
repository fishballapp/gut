import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatProbabilities,
  formatProbability,
  formatTokens,
  formatTokensCompact,
} from './format.ts';

describe('formatProbability', () => {
  it('drops the leading zero and keeps two places', () => {
    expect(formatProbability(0.58)).toBe('.58');
    expect(formatProbability(0.099)).toBe('.10');
    expect(formatProbability(0.01)).toBe('.01');
  });

  it('writes certainty as a whole number', () => {
    expect(formatProbability(0)).toBe('0');
    expect(formatProbability(1)).toBe('1');
  });
});

describe('formatProbabilities', () => {
  it('joins one per turn', () => {
    expect(formatProbabilities([0.58, 0.64])).toBe('.58 → .64');
    expect(formatProbabilities([1, 0.12, 0.61])).toBe('1 → .12 → .61');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds under a second and seconds above', () => {
    expect(formatDuration(24.5)).toBe('25ms');
    expect(formatDuration(1400)).toBe('1.4s');
    expect(formatDuration(3100)).toBe('3.1s');
  });
});

describe('formatTokens', () => {
  it('groups thousands', () => {
    expect(formatTokens(2880)).toBe('2,880');
  });
});

describe('formatTokensCompact', () => {
  it('keeps small counts whole and shortens thousands', () => {
    expect(formatTokensCompact(0)).toBe('0');
    expect(formatTokensCompact(999)).toBe('999');
    expect(formatTokensCompact(1000)).toBe('1k');
    expect(formatTokensCompact(17_400)).toBe('17.4k');
    expect(formatTokensCompact(50_000)).toBe('50k');
  });
});
