import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export default async function (
  { inspect, port, open }: { inspect: boolean; port?: number; open: boolean },
  ...[file, ...args]: string[]
) {
  if (file === undefined) throw new Error('gut run needs a task file');
  // The task reads its own args as process.argv.slice(2), the same as under `node <file>`.
  process.argv = [process.argv[0] ?? 'node', file, ...args];
  const taskUrl = pathToFileURL(resolve(file)).href;
  if (!inspect) {
    await import(taskUrl);
    return;
  }
  const { runInspected } = await import('../../inspect/run.ts');
  await runInspected(file, taskUrl, { port: port ?? 0, open });
}
