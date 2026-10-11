import type { Decision } from '../state/inspector-state.ts';

/** The decision a turn of this run waits on for the developer to answer, if any. */
export const findAwaitingTurn = (
  pending: readonly Decision[],
  runId: string,
  round: number,
  turn: number,
): Decision | undefined =>
  pending.find(
    decision =>
      decision.runId === runId &&
      decision.round === round &&
      decision.on.kind === 'turn' &&
      decision.on.turn === turn,
  );

/** The decision that holds a round's picked step until the developer runs it, if any. */
export const findWaitingStep = (
  pending: readonly Decision[],
  runId: string,
  round: number,
): Decision | undefined =>
  pending.find(
    decision => decision.runId === runId && decision.round === round && decision.on.kind === 'step',
  );

/** The decision waiting for a round: a turn to answer, or a step to run. */
export const findRoundDecision = (
  pending: readonly Decision[],
  runId: string,
  round: number,
): Decision | undefined =>
  pending.find(decision => decision.runId === runId && decision.round === round);
