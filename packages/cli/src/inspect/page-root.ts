// Where the built page is: `@gut.run/inspector`'s files, the same from source and from npm.
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The built page's directory, from `@gut.run/inspector`, the same from source and from npm. */
export const inspectorRoot = () => {
  const index = (() => {
    try {
      return fileURLToPath(import.meta.resolve('@gut.run/inspector/index.html'));
    } catch {
      return undefined;
    }
  })();
  if (index === undefined || !existsSync(index)) {
    throw new Error(
      "gut inspector: the page isn't built. In the gut repo: pnpm -F @gut.run/inspector build",
    );
  }
  return dirname(index);
};
