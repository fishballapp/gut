import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (
  { inspect, port, open }: { inspect: boolean; port?: number; open: boolean },
  ...[file, ...args]: string[]
) {
  if (file === undefined) throw new Error('gut run needs a task file');
  // An inspected run forks this same entry to run the task in, so it is read before argv changes.
  const entry = process.argv[1];
  // The task reads its own args as process.argv.slice(2), the same as under `node <file>`.
  process.argv = [process.argv[0] ?? 'node', file, ...args];
  const taskUrl = pathToFileURL(resolve(file)).href;
  if (!inspect) {
    const { isInspectChild, runInspectChild } = await import('../../inspect/child.ts');
    if (isInspectChild()) return runInspectChild(taskUrl);
    await import(taskUrl);
    return;
  }
  if (entry === undefined) throw new Error('gut run --inspect: no CLI entry to run the task in');
  const { runInspected } = await import('../../inspect/run.ts');
  await runInspected(file, args, { entry, port: port ?? 0, open });
}
