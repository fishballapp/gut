import { describe, expect, it } from 'vitest';
import { arrow, flightOnto, flow } from './flights.ts';

describe('a flight', () => {
  it('shrinks a card onto a line, whole and centred', () => {
    const card = { x: 0, y: 0, width: 200, height: 80 };
    const line = { x: 300, y: 500, width: 400, height: 20 };
    const { x, y, scale } = flightOnto(card, line);
    expect(scale).toBe(0.25);
    // Its top-left lands so that its 50 × 20 box sits in the middle of the line.
    expect({ x, y }).toEqual({ x: 300 + (400 - 50) / 2, y: 500 });
  });

  it('grows a small piece onto a large one', () => {
    expect(
      flightOnto({ x: 10, y: 10, width: 10, height: 10 }, { x: 0, y: 0, width: 100, height: 50 }),
    ).toEqual({ x: 15, y: -10, scale: 5 });
  });

  it('leaves a piece with no size where it is', () => {
    expect(
      flightOnto({ x: 10, y: 10, width: 0, height: 0 }, { x: 0, y: 0, width: 100, height: 50 }),
    ).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe('an arrow', () => {
  it('flows out and in along its axis', () => {
    expect(flow({ x: 0, y: 0 }, { x: 100, y: 40 }, 'x').line).toBe('M0 0C50 0 50 40 100 40');
    expect(flow({ x: 0, y: 0 }, { x: 40, y: 100 }, 'y').line).toBe('M0 0C0 50 40 50 40 100');
  });

  it('points its head along the curve as it arrives', () => {
    const { head } = arrow({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    const [left, tip, right] = head.slice(1).split('L');
    expect(tip).toBe('100 0');
    // Both wings trail behind the tip, one either side.
    expect([left, right].map(point => point?.split(' ').map(Number))).toEqual([
      [92.1, -4.3],
      [92.1, 4.3],
    ]);
  });
});
