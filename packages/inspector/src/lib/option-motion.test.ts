import { describe, expect, it } from 'vitest';
import { staggerSeconds } from './option-motion.ts';

describe('staggerSeconds', () => {
  it('staggers the first rows one step apart', () => {
    expect(staggerSeconds(0)).toBe(0);
    expect(staggerSeconds(3)).toBeCloseTo(0.09);
  });

  it('holds every row past the tenth at the tenth one’s delay', () => {
    expect(staggerSeconds(10)).toBeCloseTo(0.3);
    expect(staggerSeconds(254)).toBeCloseTo(0.3);
  });
});
