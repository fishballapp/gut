import gut from '../assets/gut.png';

/** gut's mascot, drawn across the whole page in the ink colour, barely there. */
export const GutBackground = () => (
  <div
    aria-hidden
    className="pointer-events-none fixed inset-0 -z-10 bg-ink opacity-(--gut-opacity)"
    style={{
      maskImage: `url(${gut})`,
      maskSize: 'cover',
      maskPosition: 'center',
      maskRepeat: 'no-repeat',
    }}
  />
);
