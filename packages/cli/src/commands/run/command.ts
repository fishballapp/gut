// gut run <task.gut.ts> [-- args…]
import { buildCommand } from '@stricli/core';

export const runCommand = buildCommand({
  loader: async () => import('./impl.ts'),
  parameters: {
    flags: {},
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
