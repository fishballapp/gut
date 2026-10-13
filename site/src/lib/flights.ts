// The story's geometry, apart from the DOM: how one piece of the scene lays itself over another
// (a flight), and the curves its arrows draw. The page measures boxes once per layout and writes
// these as custom properties and path data; CSS transitions do the moving.

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** A translate, then a uniform scale from the top-left corner. */
export type Flight = { x: number; y: number; scale: number };

/**
 * The flight that lays `from` over `to`: scaled to fit inside it, whole, and centred on it, so a
 * card shrinks onto a line of code and a line of code grows onto a card without overflowing either.
 */
export const flightOnto = (from: Box, to: Box): Flight => {
  if (from.width === 0 || from.height === 0) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return {
    x: to.x + (to.width - from.width * scale) / 2 - from.x,
    y: to.y + (to.height - from.height * scale) / 2 - from.y,
    scale,
  };
};

const round = (value: number) => Math.round(value * 10) / 10;

/** An open arrowhead at `tip`, pointing away from `from` (the curve's last control point). */
const headAt = (tip: Point, from: Point, size = 9) => {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = (turn: number) => ({
    x: tip.x - size * Math.cos(angle + turn),
    y: tip.y - size * Math.sin(angle + turn),
  });
  return `M${[wing(0.5), tip, wing(-0.5)].map(p => `${round(p.x)} ${round(p.y)}`).join('L')}`;
};

/** An arrow: a cubic curve from `start` to `end` through two control points, and its head. */
export const arrow = (start: Point, c1: Point, c2: Point, end: Point) => ({
  line: `M${round(start.x)} ${round(start.y)}C${[c1, c2, end].map(p => `${round(p.x)} ${round(p.y)}`).join(' ')}`,
  head: headAt(end, c2),
});

/** An arrow that leaves `start` and meets `end` along one axis: a flow between columns or rows. */
export const flow = (start: Point, end: Point, axis: 'x' | 'y') => {
  if (axis === 'x') {
    const half = (end.x - start.x) / 2;
    return arrow(start, { x: start.x + half, y: start.y }, { x: end.x - half, y: end.y }, end);
  }
  const half = (end.y - start.y) / 2;
  return arrow(start, { x: start.x, y: start.y + half }, { x: end.x, y: end.y - half }, end);
};
