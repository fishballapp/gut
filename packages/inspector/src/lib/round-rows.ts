import type { Decision, Round } from '../state/inspector-state.ts';

/** A row of the rounds sidebar: a round, or one of the selected round's turns. */
export type RoundRowKey = { round: number; turn?: number };

/** Top to bottom: each round, and the selected round's turns under it. */
export const visibleRows = (
  rounds: readonly Round[],
  selectedRound: number | undefined,
): RoundRowKey[] =>
  rounds.flatMap(round => {
    const roundRow = { round: round.round };
    if (round.round !== selectedRound) return [roundRow];
    return [roundRow, ...round.turns.map(turn => ({ round: round.round, turn: turn.turn }))];
  });

export const isSameRow = (a: RoundRowKey, b: RoundRowKey): boolean =>
  a.round === b.round && a.turn === b.turn;

/**
 * The rows ↑/↓ stop on. A selected round with turns is stopped on through its selected turn, not
 * its own row: selecting that row again resolves to the same turn, so the cursor could not leave.
 */
export const stopRows = (
  rows: readonly RoundRowKey[],
  selected: RoundRowKey | undefined,
): RoundRowKey[] =>
  rows.filter(
    row =>
      !(selected?.turn !== undefined && row.turn === undefined && row.round === selected.round),
  );

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

export const isAwaitingYou = (
  pending: readonly Decision[],
  runId: string,
  round: number,
  turn: number,
): boolean => findAwaitingTurn(pending, runId, round, turn) !== undefined;

export const isWaitingToRun = (
  pending: readonly Decision[],
  runId: string,
  round: number,
): boolean => findWaitingStep(pending, runId, round) !== undefined;
