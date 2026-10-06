// gut.config.json: the working directory's, else ~/gut.config.json.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DecisionModelSchema } from './decision-model.ts';

// Strict, so a key gut no longer reads (or a typo) fails instead of being ignored.
const ConfigSchema = z.strictObject({ decisionModel: DecisionModelSchema });

export type Config = z.infer<typeof ConfigSchema>;

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

export const loadConfig = async (from = process.cwd()): Promise<Config> => {
  const config =
    (await readConfig(join(from, 'gut.config.json'))) ??
    (await readConfig(join(homedir(), 'gut.config.json')));
  if (config !== undefined) return config;
  // TODO(docs): link the configuration docs here once they're published.
  throw new Error(
    `No gut config: create gut.config.json in this directory or ~/gut.config.json, with { "decisionModel": { "endpoint": "http://localhost:11434/v1/systemone", "name": "clef-flash" } }`,
  );
};
