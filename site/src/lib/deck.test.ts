import { describe, expect, it } from 'vitest';
import { createDeck, createWheelReader, fateOf, SLIDE_MS, type WheelSample } from './deck.ts';

// A trackpad swipe as Chrome on a Mac delivers it: a short push that ramps up, then inertia that
// decays to nothing, one event a frame.
const swipe = ({
  from = 0,
  peak = 60,
  events = 30,
  ms = 1200,
  direction = 1,
} = {}): WheelSample[] =>
  Array.from({ length: events }, (_, index) => {
    const ramp = [0.15, 0.5, 1][index] ?? 1;
    const decay = 0.86 ** Math.max(0, index - 2);
    return {
      time: from + (index * ms) / events,
      deltaY: direction * Math.max(1, Math.round(peak * ramp * decay)),
    };
  });

const gestureStarts = (samples: WheelSample[]) => {
  const reader = createWheelReader();
  return samples.flatMap(sample => (reader.read(sample) ? [sample.time] : []));
};

// Feeds samples to a deck of ten slides, as the page does, and returns the slide it ends on.
const play = (samples: WheelSample[], deck = createDeck(10)) => {
  const reader = createWheelReader();
  for (const sample of samples) {
    deck.input({
      direction: sample.deltaY > 0 ? 1 : -1,
      time: sample.time,
      isNewGesture: reader.read(sample),
    });
  }
  return deck.slide;
};

describe('reading wheel events as gestures', () => {
  it('reads a mouse notch as one gesture', () => {
    expect(gestureStarts([{ time: 0, deltaY: 100 }])).toEqual([0]);
  });

  it('reads notches a pause apart as separate gestures', () => {
    expect(
      gestureStarts([
        { time: 0, deltaY: 100 },
        { time: 400, deltaY: 100 },
      ]),
    ).toEqual([0, 400]);
  });

  it('reads the decaying inertia after a swipe as the same gesture', () => {
    const starts = gestureStarts(swipe());
    // The ramp of the push may read as new pushes, but nothing after it does.
    expect(starts.every(time => time < 100)).toBe(true);
  });

  it('reads a swipe that starts during the last one’s inertia as a new gesture', () => {
    const second = gestureStarts([...swipe(), ...swipe({ from: 1200 })]).filter(
      time => time >= 1200,
    );
    expect(second.length).toBeGreaterThan(0);
  });

  it('does not read a slow tail’s jitter as a new gesture', () => {
    const tail = [1, 1, 2, 1, 2, 2, 1, 3, 1].map((deltaY, index) => ({ time: index * 16, deltaY }));
    expect(gestureStarts(tail)).toEqual([0]);
  });

  it('reads a change of direction as a new gesture', () => {
    expect(
      gestureStarts([
        { time: 0, deltaY: 40 },
        { time: 16, deltaY: -40 },
      ]),
    ).toEqual([0, 16]);
  });
});

describe('the fate of a gesture', () => {
  it('moves one slide in its direction', () => {
    expect(fateOf({ slide: 3, count: 10, direction: 1, isAnimating: false })).toEqual({
      kind: 'move',
      slide: 4,
    });
    expect(fateOf({ slide: 3, count: 10, direction: -1, isAnimating: false })).toEqual({
      kind: 'move',
      slide: 2,
    });
  });

  it('does nothing while a slide animates', () => {
    expect(fateOf({ slide: 3, count: 10, direction: 1, isAnimating: true })).toEqual({
      kind: 'ignore',
    });
  });

  it('lets go past either end', () => {
    expect(fateOf({ slide: 9, count: 10, direction: 1, isAnimating: false })).toEqual({
      kind: 'release',
    });
    expect(fateOf({ slide: 0, count: 10, direction: -1, isAnimating: false })).toEqual({
      kind: 'release',
    });
  });
});

describe('the deck', () => {
  it('moves one slide for a mouse notch', () => {
    expect(play([{ time: 0, deltaY: 100 }])).toBe(1);
  });

  it('moves one slide for a whole trackpad swipe, inertia and all', () => {
    expect(play(swipe())).toBe(1);
  });

  it('moves one slide for a hard fling, however long its inertia', () => {
    expect(play(swipe({ peak: 300, events: 150, ms: 2500 }))).toBe(1);
  });

  it('moves one slide for each of two swipes back to back', () => {
    expect(play([...swipe(), ...swipe({ from: 1200 })])).toBe(2);
  });

  it('ignores a gesture that starts while a slide animates', () => {
    expect(
      play([
        { time: 0, deltaY: 100 },
        { time: SLIDE_MS / 2, deltaY: 100 },
      ]),
    ).toBe(1);
  });

  it('takes the next gesture once the animation is over', () => {
    expect(
      play([
        { time: 0, deltaY: 100 },
        { time: SLIDE_MS + 10, deltaY: 100 },
      ]),
    ).toBe(2);
  });

  it('lets the page scroll for a gesture past the last slide, and only for that one', () => {
    const deck = createDeck(2);
    expect(deck.input({ direction: 1, time: 0, isNewGesture: true })).toBe(false);
    expect(deck.input({ direction: 1, time: 1000, isNewGesture: true })).toBe(true);
    expect(deck.input({ direction: 1, time: 1016, isNewGesture: false })).toBe(true);
    expect(deck.slide).toBe(1);
  });

  it('spends the gesture in flight when it goes to a slide by itself', () => {
    const deck = createDeck(10);
    deck.go(9, 0);
    expect(deck.input({ direction: 1, time: 16, isNewGesture: false })).toBe(false);
    expect(deck.input({ direction: -1, time: SLIDE_MS / 2, isNewGesture: true })).toBe(false);
    expect(deck.slide).toBe(9);
  });
  it('stays busy for as long as a slide plays when stepping onto it', () => {
    const deck = createDeck(10, { 1: 1200 });
    deck.input({ direction: 1, time: 0, isNewGesture: true });
    deck.input({ direction: 1, time: 1000, isNewGesture: true });
    expect(deck.slide).toBe(1);
    deck.input({ direction: 1, time: 1210, isNewGesture: true });
    expect(deck.slide).toBe(2);
  });

  it("reverses a long slide in a plain slide's time", () => {
    const deck = createDeck(10, { 1: 1200 });
    deck.go(2, 0);
    deck.input({ direction: -1, time: SLIDE_MS + 10, isNewGesture: true });
    expect(deck.slide).toBe(1);
    deck.input({ direction: -1, time: 2 * SLIDE_MS + 20, isNewGesture: true });
    expect(deck.slide).toBe(0);
  });
});
