// gut — a non-deterministic runtime: you write the moves, a decision model writes the order.
import { buildApplication, buildRouteMap } from '@stricli/core';
import { runCommand } from './commands/run/command.ts';

export const app = buildApplication(
  buildRouteMap({
    routes: { run: runCommand },
    docs: {
      brief: 'A non-deterministic runtime: you write the moves, a decision model writes the order',
    },
  }),
  {
    name: 'gut',
    scanner: { allowArgumentEscapeSequence: true, caseStyle: 'allow-kebab-for-camel' },
  },
);
