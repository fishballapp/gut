// The page imports `@gut.run/core/inspector` in the browser, so nothing it reaches may import a
// Node built-in: one re-export of the config loader once left the page blank.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const IMPORT = /^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm;

/** Every module specifier `entry` reaches through relative imports, type-only ones skipped. */
const reachedSpecifiers = async (entry: string): Promise<Set<string>> => {
  const seen = new Set<string>();
  const specifiers = new Set<string>();
  const visit = async (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(IMPORT)) {
      const [statement, specifier] = match;
      if (specifier === undefined || /^\s*(?:import|export)\s+type\b/.test(statement)) continue;
      if (specifier.startsWith('.')) {
        await visit(resolve(dirname(file), specifier));
      } else {
        specifiers.add(specifier);
      }
    }
  };
  await visit(entry);
  return specifiers;
};

describe('@gut.run/core/inspector', () => {
  it('reaches no Node built-in, so the page can import it', async () => {
    const entry = fileURLToPath(new URL('./inspector.ts', import.meta.url));
    const specifiers = [...(await reachedSpecifiers(entry))];
    expect(specifiers.filter(specifier => specifier.startsWith('node:'))).toEqual([]);
  });
});
