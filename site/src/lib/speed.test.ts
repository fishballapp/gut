import { describe, expect, it } from 'vitest';
import { medianMs, readMedianMs } from './speed.ts';

describe('the median time per request', () => {
  it('reads the figure from the sentence that states it', () => {
    expect(readMedianMs('took a median of 255 ms (p90 330 ms)')).toBe(255);
  });

  it('is stated in the README', () => {
    expect(medianMs).toBeGreaterThan(0);
  });

  it('fails when the README no longer states one', () => {
    expect(() => readMedianMs('Fast.')).toThrow(/median time per request/);
  });
});
