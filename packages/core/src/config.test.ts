import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.ts';

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
  return { root, home };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

// A config naming its decision model `name`, and what loading it gives back.
const configFor = (name: string, port = 1) => ({
  decisionModel: { endpoint: `http://localhost:${port}/v1/systemone`, name },
});
const loadedFor = (name: string, port = 1) => ({
  decisionModel: {
    ...configFor(name, port).decisionModel,
    capabilities: { image: false, choiceQuestions: { maxOptions: 26 } },
  },
});

describe('loadConfig', () => {
  it("reads the directory's gut.config.json", async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'gut.config.json'), JSON.stringify(configFor('local')));

    expect(await loadConfig(root)).toEqual(loadedFor('local'));
  });

  it("reads the model's capabilities, defaulting what is left out", async () => {
    const { root } = await fixture();
    const write = (capabilities: unknown) =>
      writeFile(
        join(root, 'gut.config.json'),
        JSON.stringify({
          decisionModel: { ...configFor('local').decisionModel, capabilities },
        }),
      );

    await write({ choiceQuestions: { maxOptions: 10 } });
    expect((await loadConfig(root)).decisionModel.capabilities).toEqual({
      image: false,
      choiceQuestions: { maxOptions: 10 },
    });

    await write({ image: true });
    expect((await loadConfig(root)).decisionModel.capabilities).toEqual({
      image: true,
      choiceQuestions: { maxOptions: 26 },
    });

    await write({ choiceQuestions: { maxOptions: 1 } });
    await expect(loadConfig(root)).rejects.toThrow('maxOptions');
  });

  it("does not read a parent directory's config", async () => {
    const { root } = await fixture();
    const nested = join(root, 'a');
    await mkdir(nested);
    await writeFile(join(root, 'gut.config.json'), JSON.stringify(configFor('parent')));

    await expect(loadConfig(nested)).rejects.toThrow('No gut config');
  });

  it('names an invalid file without falling back to the home config', async () => {
    const { root, home } = await fixture();
    await writeFile(
      join(root, 'gut.config.json'),
      JSON.stringify({ decisionModel: { name: 'clef-flash' } }),
    );
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));

    await expect(loadConfig(root)).rejects.toThrow(join(root, 'gut.config.json'));
  });

  it('reads the home config when there is no local config', async () => {
    const { root, home } = await fixture();
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));

    expect(await loadConfig(root)).toEqual(loadedFor('home'));
  });

  it("uses the directory's file over the home one, without merging", async () => {
    const { root, home } = await fixture();
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));
    await writeFile(join(root, 'gut.config.json'), JSON.stringify(configFor('local', 2)));

    expect(await loadConfig(root)).toEqual(loadedFor('local', 2));
  });

  it('rejects a key gut does not read, at any level', async () => {
    const { root } = await fixture();
    await writeFile(
      join(root, 'gut.config.json'),
      JSON.stringify({ ...configFor('local'), maxTicks: 12 }),
    );
    await expect(loadConfig(root)).rejects.toThrow('maxTicks');

    await writeFile(
      join(root, 'gut.config.json'),
      JSON.stringify({ decisionModel: { ...configFor('local').decisionModel, model: 'local' } }),
    );
    await expect(loadConfig(root)).rejects.toThrow('model');
  });

  it('reports how to configure gut when no file exists', async () => {
    const { root } = await fixture();
    await expect(loadConfig(root)).rejects.toThrow('No gut config: create gut.config.json');
  });

  it('does not search past a file with malformed JSON', async () => {
    const { root, home } = await fixture();
    await writeFile(join(root, 'gut.config.json'), '{');
    await writeFile(join(home, 'gut.config.json'), JSON.stringify(configFor('home')));

    await expect(loadConfig(root)).rejects.toBeInstanceOf(SyntaxError);
  });
});
