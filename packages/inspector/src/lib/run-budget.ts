// Model spend for the budget meter: the tokens the model was asked with, against the run's budget.
import type { Run } from '../state/inspector-state.ts';
import { formatTokensCompact } from './format.ts';

export type RunBudget = {
  inputTokens: number;
  requests: number;
  budget: number;
};

/**
 * What the model has been asked in this run: every turn it answered, including an answer waiting for
 * you or one you replaced, and what each abandoned pick spent.
 */
export const runBudget = (run: Run): RunBudget => {
  let inputTokens = 0;
  let requests = 0;
  for (const round of run.rounds) {
    for (const pick of round.picks) {
      inputTokens += pick.abandoned?.inputTokens ?? 0;
      requests += pick.abandoned?.requests ?? 0;
    }
    for (const turn of round.turns) {
      const asked =
        turn.suggestion ??
        (turn.outcome.status === 'answered' && turn.outcome.by.kind === 'model'
          ? turn.outcome
          : undefined);
      if (asked === undefined) continue;
      inputTokens += asked.inputTokens;
      requests += 1;
    }
  }
  return { inputTokens, requests, budget: run.inputTokenBudget };
};

export const formatBudgetLabel = ({ inputTokens, requests, budget }: RunBudget): string =>
  `${formatTokensCompact(inputTokens)} / ${formatTokensCompact(budget)} tokens · ${requests} request${requests === 1 ? '' : 's'}`;
