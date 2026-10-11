// Model spend for the budget meter: the tokens the model was asked with, against the run's budget.
import { type Run, turnSpend } from '../state/inspector-state.ts';
import { formatTokensCompact } from './format.ts';

export type RunBudget = {
  inputTokens: number;
  requests: number;
  budget: number;
};

/**
 * What the model has been asked in this run: every answer it gave or suggested, including those
 * since dropped in review or by a re-pick.
 */
export const runBudget = (run: Run): RunBudget => {
  let inputTokens = 0;
  let requests = 0;
  for (const round of run.rounds) {
    for (const spent of [round.dropped, ...round.turns.map(turnSpend)]) {
      inputTokens += spent.inputTokens;
      requests += spent.requests;
    }
  }
  return { inputTokens, requests, budget: run.inputTokenBudget };
};

export const formatBudgetLabel = ({ inputTokens, requests, budget }: RunBudget): string =>
  `${formatTokensCompact(inputTokens)} / ${formatTokensCompact(budget)} tokens · ${requests} request${requests === 1 ? '' : 's'}`;
