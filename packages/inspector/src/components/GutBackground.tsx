import { gutEyes, gutPath } from '../assets/gut.ts';

/**
 * gut's mascot, drawn across the whole page in the ink colour, barely there. It is an inline SVG,
 * not a CSS mask: the stroke is pinned to screen pixels, so the line stays the same width at any size.
 */
export const GutBackground = () => (
  <svg
    aria-hidden
    className="pointer-events-none fixed inset-0 -z-10 h-full w-full text-ink opacity-(--gut-opacity)"
    viewBox="0 0 1024 1024"
    preserveAspectRatio="xMidYMid slice"
  >
    <path
      d={gutPath}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    />
    {gutEyes.map(({ cx, cy }) => (
      <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={11} fill="currentColor" />
    ))}
  </svg>
);
