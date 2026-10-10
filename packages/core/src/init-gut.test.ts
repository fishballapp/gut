import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL } from './events.ts';
import { INSPECTOR_KEY, type InspectorGlobal, type RunHooks } from './inspector.ts';
import { op } from './ops.ts';

vi.mock('node:os', async importOriginal => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: vi.fn(),
}));

const directories: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'gut-'));
  directories.push(root);
  const home = join(root, 'home');
  await mkdir(home);
  vi.mocked(homedir).mockReturnValue(home);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  return { root, home };
};

const clearInspector = () => {
  Reflect.deleteProperty(globalThis, INSPECTOR_KEY);
};

afterEach(async () => {
  clearInspector();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.mocked(homedir).mockReset();
});

const configFor = (name: string) => ({
  decisionModel: { endpoint: 'http://localhost:1/v1/systemone', name },
});

const hooks = (overrides: Partial<RunHooks> = {}): RunHooks => ({
  onEvent: () => {},
  answer: async () => ({ by: 'model' }),
  beforePick: async () => ({ maxOptions: 26 }),
  beforeInvoke: async () => 'invoke',
  ...overrides,
});

describe('initGut with an inspector', () => {
  it('throws on a protocol mismatch, naming both numbers', async () => {
    Reflect.set(globalThis, INSPECTOR_KEY, {
      protocol: PROTOCOL + 1,
      attach: () => hooks(),
    } satisfies InspectorGlobal);
    const { initGut } = await import('./init-gut.ts');
    await expect(initGut({ config: configFor('x') })).rejects.toThrow(
      `gut inspector protocol mismatch: core is ${PROTOCOL}, inspector is ${PROTOCOL + 1}`,
    );
  });

  it('throws on an invalid global', async () => {
    Reflect.set(globalThis, INSPECTOR_KEY, { protocol: PROTOCOL });
    const { initGut } = await import('./init-gut.ts');
    await expect(initGut({ config: configFor('x') })).rejects.toThrow(/expected \{ protocol/);
  });

  it('calls attach once per run, reading the global once', async () => {
    await fixture();
    const attach = vi.fn(() => hooks());
    const inspector = { protocol: PROTOCOL, attach };
    Reflect.set(globalThis, INSPECTOR_KEY, inspector);

    const { initGut } = await import('./init-gut.ts');
    const { runTask } = await initGut({ config: configFor('x') });

    // Replace the global after initGut has read it: later runs still use the captured attach.
    Reflect.set(globalThis, INSPECTOR_KEY, {
      protocol: PROTOCOL,
      attach: () => {
        throw new Error('global was read again');
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              answers: {
                next: { choice: 'o1', probabilities: { o1: 1, o2: 0 } },
              },
              usage: { input_tokens: 1 },
            }),
          ),
      ),
    );
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const done = { value: false };
    const observe = async () => ({
      context: { goal: 'done' },
      ops: {
        go: op('Go', () => {
          done.value = true;
        }),
        other: op('Other', () => {}),
      },
    });

    await runTask('test', observe, { isGoalAchieved: () => done.value });
    done.value = false;
    await runTask('test', observe, { isGoalAchieved: () => done.value });

    expect(attach).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('runs with no config under an inspector', async () => {
    await fixture();
    const done = { value: false };
    Reflect.set(globalThis, INSPECTOR_KEY, {
      protocol: PROTOCOL,
      attach: () =>
        hooks({
          answer: async ({ request }) => {
            const answers: Record<string, string> = {};
            for (const [key, question] of Object.entries(request.questions)) {
              const choice =
                Object.entries(question.criteria).find(([, text]) => text === 'Go')?.[0] ??
                Object.keys(question.criteria)[0];
              if (choice === undefined) throw new Error('no choice');
              answers[key] = choice;
            }
            return { by: 'you', answers };
          },
        }),
    } satisfies InspectorGlobal);

    const { initGut } = await import('./init-gut.ts');
    const { runTask } = await initGut();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'done' },
        ops: {
          go: op('Go', () => {
            done.value = true;
          }),
          other: op('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => done.value },
    );
    expect(result.status).toBe('achieved');
  });

  it('still throws for an explicit missing configJsonPath under an inspector', async () => {
    const { root } = await fixture();
    Reflect.set(globalThis, INSPECTOR_KEY, {
      protocol: PROTOCOL,
      attach: () => hooks(),
    } satisfies InspectorGlobal);
    const { initGut } = await import('./init-gut.ts');
    const missing = join(root, 'missing.json');
    await expect(initGut({ configJsonPath: missing })).rejects.toThrow(
      `No gut config at ${missing}`,
    );
  });

  it('attaches hooks from a separately loaded module', async () => {
    await fixture();
    vi.resetModules();
    Reflect.set(globalThis, INSPECTOR_KEY, {
      protocol: PROTOCOL,
      attach: () =>
        hooks({
          answer: async ({ request }) => {
            const answers: Record<string, string> = {};
            for (const [key, question] of Object.entries(request.questions)) {
              const choice = Object.keys(question.criteria)[0];
              if (choice === undefined) throw new Error('no choice');
              answers[key] = choice;
            }
            return { by: 'you', answers };
          },
        }),
    } satisfies InspectorGlobal);

    const { initGut } = await import('./init-gut.ts');
    const { op: freshOp } = await import('./ops.ts');
    const { runTask } = await initGut();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const done = { value: false };
    const result = await runTask(
      'test',
      async () => ({
        context: { goal: 'done' },
        ops: {
          go: freshOp('Go', () => {
            done.value = true;
          }),
          other: freshOp('Other', () => {}),
        },
      }),
      { isGoalAchieved: () => done.value },
    );
    expect(result.status).toBe('achieved');
  });
});
