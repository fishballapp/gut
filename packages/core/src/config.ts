// A gut config: given inline, read from a file, or found as ./gut.config.json, else ~/gut.config.json.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExclusifyUnion } from 'type-fest';
import { z } from 'zod';
import { type DecisionModel, DecisionModelSchema } from './decision-model.ts';

// Strict, so a key gut no longer reads (or a typo) fails instead of being ignored.
const ConfigSchema = z.strictObject({ decisionModel: DecisionModelSchema });

export type Config = z.infer<typeof ConfigSchema>;
/** A config as written, before defaults (e.g. `maxOptions`) are filled in. */
export type ConfigInput = z.input<typeof ConfigSchema>;

/** Config after loading, when an inspector may run with no model yet. */
export type LoadedConfig = { decisionModel: DecisionModel | null };

/** Where a config comes from, when not found by the default lookup. */
export type ConfigSource = ExclusifyUnion<{ configJsonPath: string } | { config: ConfigInput }>;

/** A config file's text, checked; `source` names it in the error. */
const parseConfig = (text: string, source: string): Config => {
  const json = (() => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${source}: not JSON`);
    }
  })();
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${source}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
};

const readConfig = async (path: string): Promise<Config | undefined> => {
  const text = await (async () => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  })();
  if (text === undefined) return undefined;
  return parseConfig(text, path);
};

export async function loadConfig(source?: ConfigSource): Promise<Config>;
export async function loadConfig(
  source: ConfigSource | undefined,
  options: { allowMissing: true },
): Promise<LoadedConfig>;
export async function loadConfig(
  source?: ConfigSource,
  options?: { allowMissing: true },
): Promise<Config | LoadedConfig> {
  if (source?.config !== undefined) {
    const parsed = ConfigSchema.safeParse(source.config);
    if (!parsed.success) throw new Error(`gut config: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }
  if (source?.configJsonPath !== undefined) {
    // Relative to where gut was started, like any path a command is given.
    const path = resolve(source.configJsonPath);
    const config = await readConfig(path);
    if (config === undefined) throw new Error(`No gut config at ${path}`);
    return config;
  }
  const config =
    (await readConfig(join(process.cwd(), 'gut.config.json'))) ??
    (await readConfig(join(homedir(), 'gut.config.json')));
  if (config !== undefined) return config;
  if (options?.allowMissing === true) return { decisionModel: null };
  // TODO(docs): link the configuration docs here once they're published.
  throw new Error(
    'No gut config: create gut.config.json in this directory or ~/gut.config.json, with { "decisionModel": { "endpoint": "http://localhost:11434/v1/systemone", "name": "clef-flash" } }',
  );
}
