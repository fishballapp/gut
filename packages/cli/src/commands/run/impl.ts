import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (_flags: Record<string, never>, ...[file, ...args]: string[]) {
  if (file === undefined) throw new Error('gut run needs a task file');
  // The task reads its own args as process.argv.slice(2), the same as under `node <file>`.
  process.argv = [process.argv[0] ?? 'node', file, ...args];
  await import(pathToFileURL(resolve(file)).href);
}
