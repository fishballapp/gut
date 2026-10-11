// What the rounds rail says on hover: a round's turns and what it did; a turn's questions and the
// answer each got. Probabilities stay in the turn view.
import type { Round, Turn } from '../state/inspector-state.ts';
import type { CurrentState } from './current-turn.ts';
import { pickedOp } from './round-title.ts';

/** Coral for what needs you or went wrong; plain otherwise. */
export type Tone = 'plain' | 'you';

/** What a round did, or where it stands: a label, and the move it is about when there is one. */
export type RoundOutcome = { label: string; move?: string; tone: Tone };

export type TurnAnswerLine = { question: string; answer: string };

/** A turn on hover: where it stands while it is not answered, else each question and its answer. */
export type TurnTip =
  | { kind: 'status'; text: string; tone: Tone }
  | { kind: 'answers'; answers: TurnAnswerLine[] };

const firstLine = (text: string): string => text.split('\n', 1)[0] ?? '';

/** A group's or bundle's "contains:" at the end of its first line. */
const CONTAINS = /\s*(—\s*)?contains:\s*$/i;

/**
 * An option on one line: its first line, without a group's "— contains:"; a bundle, whose first line
 * is only "Contains:", reads as what it holds.
 */
export const optionLine = (text: string): string => {
  const [first = '', ...rest] = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
  const head = first.replace(CONTAINS, '');
  return head !== '' ? head : rest.join(', ');
};

export const turnCount = (round: Round): string => {
  const n = round.turns.length;
  if (n === 0) return 'no turns';
  return `${n} ${n === 1 ? 'turn' : 'turns'}`;
};

/** What the picked move reads as; undefined for a goal step or before a pick. */
const pickedMove = (round: Round): string | undefined => {
  const { picked } = round;
  if (picked === undefined || picked.address === null) return undefined;
  return pickedOp(round.ops, picked.address)?.move ?? picked.step;
};

export const roundOutcome = (
  round: Round,
  state: CurrentState | undefined,
): RoundOutcome | undefined => {
  if (state === 'waiting-for-you') return { label: 'Waiting for you', tone: 'you' };
  if (state === 'in-flight') return { label: 'The model is answering', tone: 'plain' };
  const isGoal =
    round.picked?.address === null ||
    (round.picked === undefined && round.goalChecked?.achieved === true);
  if (isGoal) return { label: 'Goal achieved', tone: 'plain' };
  const move = pickedMove(round);
  if (state === 'waiting-to-run') return { label: 'Ready to run', move, tone: 'you' };
  if (round.invoked?.error !== undefined) {
    return { label: 'Failed', move: firstLine(round.invoked.error), tone: 'you' };
  }
  if (round.invoked !== undefined) return { label: 'Ran', move, tone: 'plain' };
  if (move !== undefined) return { label: 'Running', move, tone: 'plain' };
  return undefined;
};

export const turnTip = (turn: Turn, state: CurrentState | undefined): TurnTip => {
  const { outcome } = turn;
  if (state === 'waiting-for-you') {
    const text = turn.suggestion === undefined ? 'Waiting for you' : 'Waiting for you to confirm';
    return { kind: 'status', text, tone: 'you' };
  }
  switch (outcome.status) {
    case 'asked':
      return { kind: 'status', text: 'The model is answering', tone: 'plain' };
    case 'failed':
      return { kind: 'status', text: `Failed: ${firstLine(outcome.error)}`, tone: 'you' };
    case 'dropped':
      return { kind: 'status', text: 'Dropped: the budget ran out', tone: 'plain' };
    case 'answered':
      return {
        kind: 'answers',
        answers: Object.entries(turn.request.questions).map(([key, question]) => {
          const choice = outcome.answers[key]?.choice;
          const answer = choice === undefined ? undefined : question.criteria[choice];
          return { question: question.instructions, answer: optionLine(answer ?? '—') };
        }),
      };
  }
};
