// Where a gut file says which config it runs on, and gets the `runTask` that uses it.
import { type ConfigSource, loadConfig } from './config.ts';
import { type RunTask, runTask } from './task.ts';

export type InitGutOptions = ConfigSource;

/**
 * Reads the config once: inline (`config`), from a file (`configJsonPath`), or with no options
 * ./gut.config.json, else ~/gut.config.json. Returns `runTask`, which runs tasks on it.
 */
export const initGut = async (options?: InitGutOptions): Promise<{ runTask: RunTask }> => {
  const config = await loadConfig(options);
  return { runTask: (tick, taskOptions) => runTask(config, tick, taskOptions) };
};
