// Where a gut file says which config it runs on, and gets the `runTask` that uses it.
import { type ConfigSource, loadConfig } from './config.ts';
import { PROTOCOL } from './events.ts';
import { INSPECTOR_KEY, type InspectorGlobal } from './inspector.ts';
import { type RunTask, runTask } from './task.ts';

export type InitGutOptions = ConfigSource;

const isInspectorGlobal = (value: unknown): value is InspectorGlobal =>
  typeof value === 'object' &&
  value !== null &&
  'protocol' in value &&
  typeof value.protocol === 'number' &&
  'attach' in value &&
  typeof value.attach === 'function';

/** Reads `globalThis[INSPECTOR_KEY]` once; an invalid value or protocol mismatch throws. */
const readInspector = (): InspectorGlobal | undefined => {
  const value: unknown = Reflect.get(globalThis, INSPECTOR_KEY);
  if (value === undefined) return undefined;
  if (!isInspectorGlobal(value)) {
    const found = (() => {
      if (value === null) return 'null';
      if (typeof value !== 'object') return typeof value;
      const keys = Object.keys(value).join(', ');
      return keys.length === 0 ? 'object' : `object with ${keys}`;
    })();
    throw new Error(
      `gut inspector: expected { protocol: number, attach: function }, found ${found}`,
    );
  }
  if (value.protocol !== PROTOCOL) {
    throw new Error(
      `gut inspector protocol mismatch: core is ${PROTOCOL}, inspector is ${value.protocol}`,
    );
  }
  return value;
};

/**
 * Reads the config once: inline (`config`), from a file (`configJsonPath`), or with no options
 * ./gut.config.json, else ~/gut.config.json. Returns `runTask`, which runs tasks on it.
 *
 * When an inspector is attached (`globalThis[INSPECTOR_KEY]`), the default lookup may come back
 * empty and its hooks are passed into each run.
 */
export const initGut = async (options?: InitGutOptions): Promise<{ runTask: RunTask }> => {
  const inspector = readInspector();
  const config =
    inspector !== undefined
      ? await loadConfig(options, { allowMissing: true })
      : await loadConfig(options);
  const attach = inspector?.attach;
  return {
    runTask: (name, observe, taskOptions) => runTask(config, name, observe, taskOptions, attach),
  };
};
