// Picking a round again from one of its turns: which turns offer it, and what it clears.
import type { Decision } from '../state/inspector-state.ts';

/**
 * Whether a turn can be picked again from: the round waits on you, and on a later turn or the step,
 * never on this turn itself.
 */
export const canPickAgainFrom = (turn: number, decision: Decision | undefined): boolean => {
  if (decision === undefined) return false;
  return decision.on.kind === 'step' || decision.on.turn > turn;
};

/** What picking again from `turn` clears, up to the round's last turn. */
export const pickAgainNote = (turn: number, lastTurn: number): string => {
  if (turn >= lastTurn) return `Turn ${turn} is cleared and asked again.`;
  const turns = lastTurn === turn + 1 ? `${turn} and ${lastTurn}` : `${turn} to ${lastTurn}`;
  return `Turns ${turns} are cleared, and turn ${turn} is asked again.`;
};
