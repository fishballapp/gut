// What a turn's block in the round strip shows: a pure function of the turn, its round, and the
// decisions the page is waiting on.
import type { Decision, Round, Turn } from '../state/inspector-state.ts';
import { formatProbability } from './format.ts';

type Answers = Extract<Turn['outcome'], { status: 'answered' }>['answers'];

export type BlockLook =
  | { kind: 'model'; probability: number }
  | { kind: 'you' }
  | { kind: 'dropped' }
  | { kind: 'failed' }
  | { kind: 'waiting' }
  | { kind: 'in-flight' };

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

const decisionsFor = (runId: string, round: number, pending: readonly Decision[]) =>
  pending.filter(decision => decision.runId === runId && decision.round === round);

/** Whether anything waits on this round: a turn to answer, or a picked step to run. */
export const isRoundWaiting = (runId: string, round: number, pending: readonly Decision[]) =>
  decisionsFor(runId, round, pending).length > 0;

/** Whether the round's picked step waits to run. */
export const isStepWaiting = (runId: string, round: number, pending: readonly Decision[]) =>
  decisionsFor(runId, round, pending).some(decision => decision.on.kind === 'step');

export const blockLook = ({
  runId,
  round,
  turn,
  pending,
}: {
  runId: string;
  round: number;
  turn: Turn;
  pending: readonly Decision[];
}): BlockLook => {
  const { outcome } = turn;
  switch (outcome.status) {
    case 'dropped':
      return { kind: 'dropped' };
    case 'failed':
      return { kind: 'failed' };
    case 'answered':
      if (outcome.by.kind === 'you') return { kind: 'you' };
      return { kind: 'model', probability: chosenProbability(outcome.answers) };
    case 'asked': {
      const isWaiting = decisionsFor(runId, round, pending).some(
        decision => decision.on.kind === 'turn' && decision.on.turn === turn.turn,
      );
      return isWaiting ? { kind: 'waiting' } : { kind: 'in-flight' };
    }
  }
};

const lookPhrase = (look: BlockLook): string => {
  switch (look.kind) {
    case 'model':
      return `${formatProbability(look.probability)}, answered by the model`;
    case 'you':
      return 'answered by you';
    case 'dropped':
      return 'dropped, the budget ran out';
    case 'failed':
      return 'failed';
    case 'waiting':
      return 'waiting for you';
    case 'in-flight':
      return 'in flight';
  }
};

/** A block's accessible name: `round 3, turn 2: .64, answered by the model`. */
export const blockName = (round: number, turn: number, look: BlockLook): string =>
  `round ${round}, turn ${turn}: ${lookPhrase(look)}`;

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
