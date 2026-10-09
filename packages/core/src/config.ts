// A gut config: given inline, read from a file, or found as ./gut.config.json, else ~/gut.config.json.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExclusifyUnion } from 'type-fest';
import { z } from 'zod';
import { DecisionModelSchema } from './decision-model.ts';

// Strict, so a key gut no longer reads (or a typo) fails instead of being ignored.
const ConfigSchema = z.strictObject({ decisionModel: DecisionModelSchema });

export type Config = z.infer<typeof ConfigSchema>;
/** A config as written, before defaults (e.g. `maxOptions`) are filled in. */
export type ConfigInput = z.input<typeof ConfigSchema>;

/** Where a config comes from, when not found by the default lookup. */
export type ConfigSource = ExclusifyUnion<{ configJsonPath: string } | { config: ConfigInput }>;

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
  const parsed = ConfigSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
};

export const loadConfig = async (source?: ConfigSource): Promise<Config> => {
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
  // TODO(docs): link the configuration docs here once they're published.
  throw new Error(
    'No gut config: create gut.config.json in this directory or ~/gut.config.json, with { "decisionModel": { "endpoint": "http://localhost:11434/v1/systemone", "name": "clef-flash" } }',
  );
};
