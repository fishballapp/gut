import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ConfigInput, loadConfig } from './config.ts';
import { DEFAULT_MAX_OPTIONS } from './decision-model.ts';
import { initGut } from './init-gut.ts';

vi.mock('node:os', async importOriginal => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: vi.fn(),
}));

// Every test owns its config search directories, including the home fallback.
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

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.mocked(homedir).mockReset(); // a module mock, which restoreAllMocks leaves as it is
});

// A config naming its decision model `name`, and what loading it gives back.
const configFor = (name: string, port = 1) => ({
  decisionModel: { endpoint: `http://localhost:${port}/v1/systemone`, name },
});
const loadedFor = (name: string, port = 1) => ({
  decisionModel: {
    ...configFor(name, port).decisionModel,
    capabilities: { image: false, choiceQuestions: { maxOptions: DEFAULT_MAX_OPTIONS } },
  },
});

describe('no-arg lookup', () => {
  it("reads the directory's gut.config.json", async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'gut.config.json'), JSON.stringify(configFor('local')));
    expect(await loadConfig()).toEqual(loadedFor('local'));

    const { runTask } = await initGut();
    expect(typeof runTask).toBe('function');
  });

  it('reads the home config when there is no local config', async () => {
    const { home } = await fixture();
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));
    expect(await loadConfig()).toEqual(loadedFor('home'));

    const { runTask } = await initGut();
    expect(typeof runTask).toBe('function');
  });

  it("uses the directory's file over the home one, without merging", async () => {
    const { root, home } = await fixture();
    await writeFile(join(root, 'gut.config.json'), JSON.stringify(configFor('local', 1)));
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home', 2)));
    expect(await loadConfig()).toEqual(loadedFor('local', 1));
  });

  it('names an invalid file without falling back to the home config', async () => {
    const { root, home } = await fixture();
    await writeFile(join(root, 'gut.config.json'), JSON.stringify({ broken: true }));
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));
    await expect(loadConfig()).rejects.toThrow(join(root, 'gut.config.json'));
    await expect(initGut()).rejects.toThrow(join(root, 'gut.config.json'));
  });

  it('does not search past a file with malformed JSON', async () => {
    const { root, home } = await fixture();
    await writeFile(join(root, 'gut.config.json'), '{');
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));
    await expect(loadConfig()).rejects.toThrow(/gut\.config\.json: not JSON/);
    await expect(initGut()).rejects.toThrow(/gut\.config\.json: not JSON/);
  });

  it('reports how to configure gut when no file exists', async () => {
    await fixture();
    await expect(loadConfig()).rejects.toThrow(
      'No gut config: create gut.config.json in this directory or ~/gut.config.json',
    );
    await expect(initGut()).rejects.toThrow(
      'No gut config: create gut.config.json in this directory or ~/gut.config.json',
    );
  });
});

describe('configJsonPath', () => {
  it('reads config from an explicit absolute path', async () => {
    const { root } = await fixture();
    const configPath = join(root, 'custom.json');
    await writeFile(configPath, JSON.stringify(configFor('custom')));
    expect(await loadConfig({ configJsonPath: configPath })).toEqual(loadedFor('custom'));

    const { runTask } = await initGut({ configJsonPath: configPath });
    expect(typeof runTask).toBe('function');
  });

  it('reads config from a relative path resolved from cwd', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'gut.rel.json'), JSON.stringify(configFor('relative')));
    expect(await loadConfig({ configJsonPath: 'gut.rel.json' })).toEqual(loadedFor('relative'));

    const { runTask } = await initGut({ configJsonPath: 'gut.rel.json' });
    expect(typeof runTask).toBe('function');
  });

  it('throws when configJsonPath does not exist', async () => {
    const { root } = await fixture();
    const missingAbs = join(root, 'missing.json');
    await expect(loadConfig({ configJsonPath: missingAbs })).rejects.toThrow(
      `No gut config at ${missingAbs}`,
    );
    await expect(initGut({ configJsonPath: missingAbs })).rejects.toThrow(
      `No gut config at ${missingAbs}`,
    );

    await expect(loadConfig({ configJsonPath: 'missing-rel.json' })).rejects.toThrow(
      `No gut config at ${join(root, 'missing-rel.json')}`,
    );
    await expect(initGut({ configJsonPath: 'missing-rel.json' })).rejects.toThrow(
      `No gut config at ${join(root, 'missing-rel.json')}`,
    );
  });

  it('names an invalid file at configJsonPath', async () => {
    const { root } = await fixture();
    const badPath = join(root, 'bad.json');
    await writeFile(badPath, JSON.stringify({ unknownKey: 1 }));
    await expect(loadConfig({ configJsonPath: badPath })).rejects.toThrow(badPath);
    await expect(initGut({ configJsonPath: badPath })).rejects.toThrow(badPath);
  });
});

describe('inline config', () => {
  it('applies defaults to capabilities when left out', async () => {
    const config = await loadConfig({ config: configFor('inline') });
    expect(config).toEqual(loadedFor('inline'));
    expect(config.decisionModel.capabilities).toEqual({
      image: false,
      choiceQuestions: { maxOptions: DEFAULT_MAX_OPTIONS },
    });

    const { runTask } = await initGut({ config: configFor('inline') });
    expect(typeof runTask).toBe('function');
  });

  it('preserves capabilities specified inline', async () => {
    const config = await loadConfig({
      config: {
        decisionModel: {
          endpoint: 'http://localhost:11434/v1/systemone',
          name: 'clef',
          capabilities: { image: true, choiceQuestions: { maxOptions: 10 } },
        },
      },
    });
    expect(config.decisionModel.capabilities).toEqual({
      image: true,
      choiceQuestions: { maxOptions: 10 },
    });
  });

  it('rejects an invalid inline config with a readable error', async () => {
    await expect(
      loadConfig({ config: { decisionModel: { name: 'clef' } } as unknown as ConfigInput }),
    ).rejects.toThrow('endpoint');
    await expect(
      initGut({ config: { decisionModel: { name: 'clef' } } as unknown as ConfigInput }),
    ).rejects.toThrow('endpoint');

    await expect(
      loadConfig({
        config: {
          decisionModel: { ...configFor('bad').decisionModel, extraKey: true },
        } as unknown as ConfigInput,
      }),
    ).rejects.toThrow('extraKey');
    await expect(
      initGut({
        config: {
          decisionModel: { ...configFor('bad').decisionModel, extraKey: true },
        } as unknown as ConfigInput,
      }),
    ).rejects.toThrow('extraKey');

    await expect(
      loadConfig({
        config: {
          decisionModel: {
            ...configFor('bad').decisionModel,
            capabilities: { choiceQuestions: { maxOptions: 1 } },
          },
        } as unknown as ConfigInput,
      }),
    ).rejects.toThrow('maxOptions');
  });
});
