// The status pill's label and optional coral/ok dot, derived from the page state and the selected run.

import type { Decision, InspectorState, Run } from '../state/inspector-state.ts';
import type { ConnectionStatus } from './connection.ts';

export type RunStatusDot = 'you' | 'ok';

export type RunStatus = {
  label: string;
  dot?: RunStatusDot;
};

const pendingFor = (pending: Decision[], runId: string): Decision | undefined =>
  pending.find(decision => decision.runId === runId);

const haltedReason = (reason: 'stalled' | 'budget' | 'noOptions' | 'error'): string => {
  switch (reason) {
    case 'stalled':
      return 'stalled';
    case 'budget':
      return 'budget';
    case 'noOptions':
      return 'nothing to pick';
    case 'error':
      return 'error';
  }
};

const roundLabel = (run: Run): number | undefined => run.rounds.at(-1)?.round;

/**
 * Priority: protocol mismatch; connection lost; a pending decision for this run; the run ended;
 * Play; Step (Paused); no run yet (Starting).
 */
export const runStatus = (
  state: InspectorState,
  run: Run | undefined,
  status: ConnectionStatus,
): RunStatus => {
  if (state.incompatible !== undefined) {
    return { label: 'Protocol mismatch' };
  }

  if (status === 'lost') {
    return { label: 'Reconnecting…' };
  }

  if (run !== undefined) {
    const pending = pendingFor(state.pending, run.runId);
    if (pending !== undefined) {
      if (pending.on.kind === 'turn') {
        return { label: `Your turn · round ${pending.round}`, dot: 'you' };
      }
      return { label: `Before the step · round ${pending.round}`, dot: 'you' };
    }

    if (run.result !== undefined) {
      if (run.result.status === 'achieved') {
        return { label: 'Achieved' };
      }
      return { label: `Halted · ${haltedReason(run.result.reason)}`, dot: 'you' };
    }

    const round = roundLabel(run);
    if (state.mode === 'play') {
      return {
        label: round === undefined ? 'Playing' : `Playing · round ${round}`,
        dot: 'ok',
      };
    }
    return {
      label: round === undefined ? 'Paused' : `Paused · round ${round}`,
    };
  }

  return { label: 'Starting' };
};
