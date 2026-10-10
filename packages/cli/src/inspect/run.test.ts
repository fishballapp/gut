import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInspected } from './run.ts';

// The page needn't be built for this: where it lives is all the server needs.
vi.mock('./page-root.ts', () => ({ inspectorRoot: () => tmpdir() }));

const ENTRY = fileURLToPath(new URL('../bin/cli.ts', import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gut-run-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

describe('runInspected', () => {
  it('stops the task when the port is taken, so nothing keeps running', async () => {
    const marker = join(dir, 'ran');
    const file = join(dir, 'task.ts');
    // The task would leave a marker after 1.5 seconds, if it were still alive.
    await writeFile(
      file,
      `setTimeout(() => import('node:fs').then(fs => fs.writeFileSync(${JSON.stringify(marker)}, 'x')), 1500);\n`,
    );
    const taken = createServer();
    await new Promise<void>(resolve => taken.listen(0, '127.0.0.1', resolve));
    const address = taken.address();
    if (address === null || typeof address === 'string') throw new Error('no port');

    try {
      await expect(
        runInspected(file, [], { entry: ENTRY, port: address.port, open: false }),
      ).rejects.toThrow(/EADDRINUSE/);
      await new Promise(resolve => setTimeout(resolve, 2500));
      await expect(readFile(marker, 'utf8')).rejects.toThrow();
    } finally {
      await new Promise(resolve => taken.close(resolve));
    }
  }, 30_000);
});
