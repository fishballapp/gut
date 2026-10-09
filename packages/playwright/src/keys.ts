/**
 * Key sanitization and collision disambiguation for op and field keys.
 */

export const sanitizeKeyPart = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';

export const claim = (
  base: string,
  used: Set<string>,
  suffixed: (n: number) => string = n => `${base}_${n}`,
): string => {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const nextAvailable = (n = 2): string => {
    const candidate = suffixed(n);
    return used.has(candidate) ? nextAvailable(n + 1) : candidate;
  };
  const key = nextAvailable();
  used.add(key);
  return key;
};
