// The story deck's input rules, apart from the DOM: which wheel event starts a new gesture, and
// what a gesture does to the deck. One gesture moves one slide; a gesture that starts while a slide
// is still animating does nothing for its whole length, so a long fling never skips slides.

/**
 * How long a slide change plays, in ms. Input that starts inside it is ignored. A slide that plays a
 * longer sequence on the way in (`playsFor`) holds input for that long, but only when the deck steps
 * onto it: going back reverses it directly, and takes this long.
 */
export const SLIDE_MS = 600;

/** A pause between wheel events this long, in ms, ends a gesture. */
const GAP_MS = 160;
/** How many earlier events of a gesture a new push is compared with. */
const RECENT = 4;
/**
 * How much larger than those a delta must be to read as a new push, not the old one's inertia: in
 * proportion, and in px, so a slow tail's jitter (1, 2, 1) never reads as one.
 */
const RISE = 1.5;
const RISE_PX = 4;

export type WheelSample = { deltaY: number; time: number };

/**
 * Reads a stream of wheel events as gestures. A gesture starts after a pause, on a change of
 * direction, or when the deltas rise again: a trackpad's inertia only ever decays, so a delta well
 * above the last few is a new swipe, even with no pause between the two.
 */
export const createWheelReader = () => {
  let recent: WheelSample[] = [];

  return {
    /** Takes the next wheel event and says whether it starts a new gesture. */
    read: (sample: WheelSample): boolean => {
      const last = recent.at(-1);
      const peak = Math.max(...recent.map(({ deltaY }) => Math.abs(deltaY)));
      const isNew =
        last === undefined ||
        sample.time - last.time > GAP_MS ||
        Math.sign(sample.deltaY) !== Math.sign(last.deltaY) ||
        Math.abs(sample.deltaY) > Math.max(peak * RISE, peak + RISE_PX);
      recent = [...(isNew ? [] : recent), sample].slice(-RECENT);
      return isNew;
    },
  };
};

/** What a gesture does: move to a slide, nothing (it came mid-animation), or leave the deck. */
export type Fate = { kind: 'move'; slide: number } | { kind: 'ignore' } | { kind: 'release' };

/** Decided once, on a gesture's first event; the rest of its events follow it. */
export const fateOf = ({
  slide,
  count,
  direction,
  isAnimating,
}: {
  slide: number;
  count: number;
  direction: 1 | -1;
  isAnimating: boolean;
}): Fate => {
  if (isAnimating) return { kind: 'ignore' };
  const next = slide + direction;
  if (next < 0 || next >= count) return { kind: 'release' };
  return { kind: 'move', slide: next };
};

/** One input event of a gesture, from a wheel, a finger or a key. */
export type DeckInput = { direction: 1 | -1; time: number; isNewGesture: boolean };

/**
 * The deck's state: its slide, until when it animates, and the fate of the gesture in flight.
 * `playsFor` holds, by slide, how long stepping onto a slide plays, where that is not `SLIDE_MS`.
 */
export const createDeck = (count: number, playsFor: Partial<Record<number, number>> = {}) => {
  let slide = 0;
  let busyUntil = Number.NEGATIVE_INFINITY;
  let fate: Fate = { kind: 'ignore' };

  /** Shows `to` from `time`, and spends the gesture in flight, so its tail moves nothing. */
  const go = (to: number, time: number) => {
    const isStep = to === slide + 1;
    slide = to;
    busyUntil = time + ((isStep ? playsFor[to] : undefined) ?? SLIDE_MS);
    fate = { kind: 'ignore' };
  };

  return {
    get slide() {
      return slide;
    },
    go,
    /** Takes one input event, and says whether the page may scroll by it (the deck let go). */
    input: ({ direction, time, isNewGesture }: DeckInput): boolean => {
      if (isNewGesture) {
        const next = fateOf({ slide, count, direction, isAnimating: time < busyUntil });
        if (next.kind === 'move') go(next.slide, time);
        fate = next;
      }
      return fate.kind === 'release';
    },
  };
};
