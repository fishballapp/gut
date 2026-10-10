// What the pick card says about a step waiting to run: the call it makes, and the turns it came from.
import type { PickedStep, Round } from '../state/inspector-state.ts';
import { pickedOp } from './round-title.ts';

/** The step as a call, read from its address in the op tree; the recorded step text when it is not there. */
export const stepCall = (round: Round, picked: PickedStep): string => {
  if (picked.address === null) return picked.step;
  const op = pickedOp(round.ops, picked.address);
  if (op === null) return picked.step;
  if (op.title.kind === 'choice') {
    return `${op.title.keys.join('.')}(${JSON.stringify(op.title.label)})`;
  }
  return [...op.title.prefix, op.title.key].join('.');
};

/** The answered turns that led to the current pick, each with who answered it. */
export const pickTrail = (round: Round): { turn: number; by: string }[] =>
  round.turns.flatMap(turn => {
    if (turn.outcome.status !== 'answered') return [];
    return [{ turn: turn.turn, by: turn.outcome.by.kind === 'you' ? 'you' : turn.outcome.by.name }];
  });
