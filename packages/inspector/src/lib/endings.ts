// How a run and the task ended, and whether the page is reconnecting: which banners the turn column
// shows, and the evidence each one carries. Pure, so the choice is tested apart from how it draws.

import type { InspectorState, Round, Run, TaskResult, Usage } from '../state/inspector-state.ts';
import type { ConnectionStatus } from './connection.ts';

export type Ending =
  | { kind: 'reconnecting' }
  | { kind: 'achieved'; rounds: number; usage: Usage }
  /** `step` and `rounds` are the picks that repeated; `step` is unset only if no round picked. */
  | { kind: 'stalled'; step?: string; rounds: number[] }
  | { kind: 'budget'; usage: Usage; inputTokenBudget: number }
  | { kind: 'error'; error: string }
  /** `round` is unset only if the run halted before any round was observed. */
  | { kind: 'nothingToPick'; round?: number }
  | { kind: 'threw'; error: string }
  | { kind: 'noRun' }
  | { kind: 'ended' };

const isSameContext = (round: Round, last: Round) =>
  JSON.stringify(round.context) === JSON.stringify(last.context);

/** The stall rule repeats a pick on the same context; every round that did so is evidence. */
const stalledEnding = (run: Run): Ending => {
  const last = run.rounds.at(-1);
  const step = last?.picked?.step;
  if (last === undefined || step === undefined) return { kind: 'stalled', rounds: [] };
  const rounds = run.rounds
    .filter(round => round.picked?.step === step && isSameContext(round, last))
    .map(round => round.round);
  return { kind: 'stalled', step, rounds };
};

const resultEnding = (run: Run, result: TaskResult): Ending => {
  if (result.status === 'achieved') {
    return { kind: 'achieved', rounds: run.rounds.length, usage: result.usage };
  }
  switch (result.reason) {
    case 'stalled':
      return stalledEnding(run);
    case 'budget':
      return { kind: 'budget', usage: result.usage, inputTokenBudget: run.inputTokenBudget };
    case 'noOptions':
      return { kind: 'nothingToPick', round: run.rounds.at(-1)?.round };
    case 'error':
      return { kind: 'error', error: result.error };
  }
};

/** The banners for the selected run, most urgent first; none when there is nothing to say. */
export const endingsFor = (
  state: InspectorState,
  run: Run | undefined,
  status: ConnectionStatus,
): Ending[] => {
  const endings: Ending[] = [];
  if (status === 'lost') endings.push({ kind: 'reconnecting' });
  if (run?.result !== undefined) endings.push(resultEnding(run, run.result));
  if (state.ended?.error !== undefined) endings.push({ kind: 'threw', error: state.ended.error });
  if (state.ended !== undefined && state.runs.length === 0) endings.push({ kind: 'noRun' });
  if (state.ended !== undefined && state.ended.error === undefined) endings.push({ kind: 'ended' });
  return endings;
};
