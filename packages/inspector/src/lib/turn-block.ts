// What a turn's block in the rounds rail shows: a pure function of the turn, and of the state it is in
// when it is the run's current turn.
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import type { CurrentState } from './current-turn.ts';
import { formatProbability } from './format.ts';

type Answers = Extract<Turn['outcome'], { status: 'answered' }>['answers'];

export type BlockLook =
  | { kind: 'model'; probability: number }
  /** The model's answer, waiting for you to keep or drop it. */
  | { kind: 'suggested'; probability: number }
  | { kind: 'you' }
  | { kind: 'dropped' }
  | { kind: 'failed' }
  | { kind: 'unanswered' };

/**
 * The chosen option's probability. A goal judged met ends the pick there, so its answer wins over
 * a move asked beside it; otherwise the move's answer, else the goal's.
 */
export const chosenProbability = (answers: Answers): number => {
  const goal = answers.achieved;
  const answer = goal?.choice === 'achieved' ? goal : (answers.next ?? goal);
  if (answer === undefined) return 0;
  return answer.probabilities[answer.choice] ?? 0;
};

export const blockLook = (turn: Turn): BlockLook => {
  const { outcome } = turn;
  switch (outcome.status) {
    case 'dropped':
      return { kind: 'dropped' };
    case 'failed':
      return { kind: 'failed' };
    case 'answered':
      if (outcome.by.kind === 'you') return { kind: 'you' };
      return { kind: 'model', probability: chosenProbability(outcome.answers) };
    case 'asked':
      return turn.suggestion === undefined
        ? { kind: 'unanswered' }
        : { kind: 'suggested', probability: chosenProbability(turn.suggestion.answers) };
  }
};

const lookPhrase = (look: BlockLook, state: CurrentState | undefined): string => {
  switch (look.kind) {
    case 'model':
      return `${formatProbability(look.probability)}, answered by the model`;
    case 'suggested':
      return `${formatProbability(look.probability)}, suggested by the model, waiting for you`;
    case 'you':
      return 'answered by you';
    case 'dropped':
      return 'dropped, the budget ran out';
    case 'failed':
      return 'failed';
    case 'unanswered':
      return state === 'waiting-for-you' ? 'waiting for you' : 'in flight';
  }
};

/**
 * A block's accessible name: `round 3, turn 2: .64, answered by the model`. `state` is given only for
 * the run's current turn.
 */
export const blockName = (
  round: number,
  turn: number,
  look: BlockLook,
  state: CurrentState | undefined,
): string => {
  const phrase = lookPhrase(look, state);
  return `round ${round}, turn ${turn}: ${phrase}${state === 'waiting-to-run' ? ', waiting to run' : ''}`;
};

/** The round `step` places away (−1 back, +1 forward), or undefined past either end. */
export const adjacentRound = (
  rounds: readonly Round[],
  round: number,
  step: -1 | 1,
): Round | undefined => {
  const index = rounds.findIndex(entry => entry.round === round);
  if (index === -1) return undefined;
  return rounds[index + step];
};

/** Whether anything waits on you in this round: a turn to answer, or a picked step to run. */
export const isRoundWaiting = (runId: string, round: number, pending: readonly Decision[]) =>
  pending.some(decision => decision.runId === runId && decision.round === round);

/** Where ←/→ stop in the rail: each turn in order, and a round with no turn as itself. */
export type RailStop = { round: number; turn?: number };

export const railStops = (rounds: readonly Round[]): RailStop[] =>
  rounds.flatMap(round =>
    round.turns.length === 0
      ? [{ round: round.round }]
      : round.turns.map(turn => ({ round: round.round, turn: turn.turn })),
  );

/** The stop `step` places from `at` (−1 back, +1 forward), across rounds; undefined past either end. */
export const adjacentStop = (
  rounds: readonly Round[],
  at: RailStop,
  step: -1 | 1,
): RailStop | undefined => {
  const stops = railStops(rounds);
  const index = stops.findIndex(stop => stop.round === at.round && stop.turn === at.turn);
  if (index === -1) return undefined;
  return stops[index + step];
};
