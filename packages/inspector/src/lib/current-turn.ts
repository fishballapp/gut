// The turn a run stands on now, read from the round's turns and the decisions the runs wait on. The
// strip and the sidebar mark it the same way.
import type { Decision, Round } from '../state/inspector-state.ts';
import { findAwaitingTurn, findWaitingStep } from './round-rows.ts';

/** What the current turn stands on: the model answering it, you answering it, or you running its pick's step. */
export type CurrentState = 'in-flight' | 'waiting-for-you' | 'waiting-to-run';

export type CurrentTurn = { turn: number; state: CurrentState };

/** Whether the current turn or step needs you, rather than the model answering. */
export const isAwaitingYou = (state: CurrentState): boolean => state !== 'in-flight';

/**
 * The round's current turn: the asked turn you are to answer, else the last turn of a pick whose
 * step waits to run, else the asked turn the model is answering. Undefined when none is current.
 */
export const currentTurnOf = (
  round: Round,
  runId: string,
  pending: readonly Decision[],
): CurrentTurn | undefined => {
  const awaited = round.turns.find(
    turn =>
      turn.outcome.status === 'asked' &&
      findAwaitingTurn(pending, runId, round.round, turn.turn) !== undefined,
  );
  if (awaited !== undefined) return { turn: awaited.turn, state: 'waiting-for-you' };
  if (findWaitingStep(pending, runId, round.round) !== undefined) {
    const last = round.turns.at(-1);
    return last === undefined ? undefined : { turn: last.turn, state: 'waiting-to-run' };
  }
  const inFlight = round.turns.find(turn => turn.outcome.status === 'asked');
  return inFlight === undefined ? undefined : { turn: inFlight.turn, state: 'in-flight' };
};

/**
 * Where the round stands: its current turn's state, or waiting to run when its pick needed no turn
 * (a lone option). Undefined when the round is not where the run is.
 */
export const roundCurrentState = (
  round: Round,
  runId: string,
  pending: readonly Decision[],
): CurrentState | undefined => {
  const current = currentTurnOf(round, runId, pending);
  if (current !== undefined) return current.state;
  const isLoneStepWaiting =
    round.turns.length === 0 && findWaitingStep(pending, runId, round.round) !== undefined;
  return isLoneStepWaiting ? 'waiting-to-run' : undefined;
};

/**
 * The state the sidebar's round row shows. While a round is open its turns carry the marker, so its
 * row carries it only when it has no turn to mark.
 */
export const rowCurrentState = (
  roundState: CurrentState | undefined,
  { isSelected, turnCount }: { isSelected: boolean; turnCount: number },
): CurrentState | undefined => (isSelected && turnCount > 0 ? undefined : roundState);
