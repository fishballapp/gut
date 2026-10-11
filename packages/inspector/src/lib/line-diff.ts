// A line diff for the context's pretty-printed JSON. The lines both sides start or end with are kept
// as they are; the middle is a longest common subsequence, computed in a table. A middle too large
// for the table reads as all removed, then all added, so a huge context costs bounded time and memory.
export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string };

/** The most cells the middle's table may take: 1,000 lines by 1,000 lines. */
const MAX_TABLE_CELLS = 1_000_000;

const sameLines = (lines: readonly string[]): DiffLine[] =>
  lines.map(text => ({ kind: 'same', text }));

/** The middle of a diff, by longest common subsequence: iterative, so no depth limit. */
const middleDiff = (a: readonly string[], b: readonly string[]): DiffLine[] => {
  if (a.length * b.length > MAX_TABLE_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'removed', text })),
      ...b.map((text): DiffLine => ({ kind: 'added', text })),
    ];
  }
  const width = b.length + 1;
  // table[i * width + j]: the longest common subsequence of a from i and of b from j.
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && left === right) {
      lines.push({ kind: 'same', text: left });
      i += 1;
      j += 1;
    } else if (
      left !== undefined &&
      (right === undefined || (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0))
    ) {
      lines.push({ kind: 'removed', text: left });
      i += 1;
    } else if (right !== undefined) {
      lines.push({ kind: 'added', text: right });
      j += 1;
    }
  }
  return lines;
};

export const lineDiff = (before: string, after: string): DiffLine[] => {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return [
    ...sameLines(a.slice(0, start)),
    ...middleDiff(a.slice(start, endA), b.slice(start, endB)),
    ...sameLines(a.slice(endA)),
  ];
};
