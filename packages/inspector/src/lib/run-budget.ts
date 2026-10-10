// Model spend for the budget meter: tokens answered by the model against the run's budget.
import type { Run } from '../state/inspector-state.ts';
import { formatTokensCompact } from './format.ts';

export type RunBudget = {
  inputTokens: number;
  requests: number;
  budget: number;
};

/** Sum of `inputTokens` on turns the model answered, and how many such requests. */
export const runBudget = (run: Run): RunBudget => {
  let inputTokens = 0;
  let requests = 0;
  for (const round of run.rounds) {
    for (const turn of round.turns) {
      if (turn.outcome.status !== 'answered') continue;
      if (turn.outcome.by.kind !== 'model') continue;
      inputTokens += turn.outcome.inputTokens;
      requests += 1;
    }
  }
  return { inputTokens, requests, budget: run.inputTokenBudget };
};

export const formatBudgetLabel = ({ inputTokens, requests, budget }: RunBudget): string =>
  `${formatTokensCompact(inputTokens)} / ${formatTokensCompact(budget)} tokens · ${requests} request${requests === 1 ? '' : 's'}`;
