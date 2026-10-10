// gut run <task.gut.ts> [--inspect [--port <n>] [--no-open]] [-- args…]
import { buildCommand, numberParser } from '@stricli/core';

export const runCommand = buildCommand({
  loader: async () => import('./impl.ts'),
  parameters: {
    flags: {
      inspect: {
        kind: 'boolean',
        brief: 'Serve the inspector: watch every turn, or answer them yourself',
        default: false,
      },
      port: {
        kind: 'parsed',
        parse: numberParser,
        brief: "The inspector's port (default: a free one)",
        optional: true,
      },
      open: {
        kind: 'boolean',
        brief: 'Open the inspector in the browser (--no-open to only print its URL)',
        default: true,
      },
    },
    positional: {
      kind: 'array',
      minimum: 1,
      parameter: {
        parse: String,
        brief: 'The task file, then its own args (put -- before any that start with -)',
        placeholder: 'task.gut.ts',
      },
    },
  },
  docs: { brief: 'Run a task file' },
});
