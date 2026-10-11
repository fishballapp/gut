// Who answers a turn, and the model call: one usage, one place that calls `requestAnswers`.

import { z } from 'zod';
import {
  type Answer,
  type DecisionModel,
  DecisionModelSchema,
  type DecisionRequest,
  RequestTooLargeError,
  requestAnswers,
} from './decision-model.ts';
import type { OptionInfoByQuestion, RunEvent } from './events.ts';
import type { Repick, RunHooks, TurnAnswer } from './inspector.ts';
import type { TurnReply } from './pick.ts';
import type { Usage } from './task.ts';

/** A person's answers, shaped like the model's, or what is wrong with them. */
export const answersFromYou = (
  request: DecisionRequest,
  chosen: Readonly<Record<string, string>>,
): Record<string, Answer> | string => {
  const unknown = Object.keys(chosen).find(key => !(key in request.questions));
  if (unknown !== undefined) return `unknown question "${unknown}"`;
  const answers: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    const choice = chosen[key];
    if (choice === undefined) return `missing answer for question "${key}"`;
    if (!(choice in question.criteria)) {
      return `unknown criterion "${choice}" for question "${key}"`;
    }
    answers[key] = { choice, probabilities: { [choice]: 1 } };
  }
  return answers;
};

/** What a turn costs when the model was not asked. */
const NOTHING_SPENT: Usage = { inputTokens: 0, requests: 0 };

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  requests: a.requests + b.requests,
});

/**
 * A turn that ended answered, or refused: what a re-pick from a later turn ends it with again, so
 * the pick splits a refused question as it did before.
 */
export type AskedTurn = {
  request: DecisionRequest;
  ending: Extract<TurnReply, { kind: 'answered' | 'failed' }>;
};

/** The first question with more options than the model takes, said as an error. */
const tooManyOptions = (request: DecisionRequest, maxOptions: number) => {
  for (const [key, question] of Object.entries(request.questions)) {
    const count = Object.keys(question.criteria).length;
    if (count > maxOptions) {
      return `question "${key}" has ${count} options; the model takes at most ${maxOptions}`;
    }
  }
  return undefined;
};

/**
 * Builds the per-round asker that `pick` uses. The turn counter starts at 1 each round and is shared
 * by every pick of that round (including re-picks).
 */
export const createTurnAnswerer = ({
  runId,
  model,
  inputTokenBudget,
  hooks,
  emit,
}: {
  runId: string;
  model: DecisionModel | null;
  inputTokenBudget: number;
  hooks: RunHooks | undefined;
  emit: (event: RunEvent) => void;
}) => {
  /** The model to ask: one the inspector supplies, checked like a config's, else the run's own. */
  const modelFor = (supplied: DecisionModel | undefined): DecisionModel | string => {
    if (supplied === undefined) return model ?? 'no decision model to answer this turn';
    const parsed = DecisionModelSchema.safeParse(supplied);
    return parsed.success
      ? parsed.data
      : `invalid decision model: ${z.prettifyError(parsed.error)}`;
  };

  /**
   * Asks one pick's turns, numbered from 1. A re-pick from a later turn hands the next pick the
   * turns before it, which it answers as before: the same ops, edits and size ask the same requests.
   */
  const forPick = (round: number, replay: readonly AskedTurn[] = []) => {
    let turn = 0;
    const asked: AskedTurn[] = [];

    /** Asks one turn: the answer hook, then the model, until the turn ends. */
    const ask = async (
      turnNumber: number,
      request: DecisionRequest,
      usage: Usage,
      optionInfo: OptionInfoByQuestion,
    ): Promise<TurnReply> => {
      emit({ type: 'turn.asked', runId, round, turn: turnNumber, request, optionInfo });
      const started = performance.now();
      /** What the model has been asked this turn, answers dropped in review included. */
      let spent = NOTHING_SPENT;

      /**
       * Records the turn as failed, with what it spent: a turn ends answered, failed or dropped, and
       * the pick throws the error once it has counted the spend.
       */
      const fail = (error: unknown): TurnReply => {
        emit({
          type: 'turn.failed',
          runId,
          round,
          turn: turnNumber,
          error: error instanceof Error ? error.message : String(error),
          isTooLarge: error instanceof RequestTooLargeError,
        });
        return { kind: 'failed', error, spent };
      };

      /** Records a re-pick: the turn is dropped with its pick. */
      const repick = ({ repickFrom }: Repick): TurnReply => {
        emit({ type: 'turn.dropped', runId, round, turn: turnNumber, reason: 'repick' });
        return { kind: 'repick', fromTurn: repickFrom, spent };
      };

      const answerAs = (
        by: Extract<RunEvent, { type: 'turn.answered' }>['by'],
        answers: Record<string, Answer>,
        inputTokens: number,
      ): TurnReply => {
        emit({
          type: 'turn.answered',
          runId,
          round,
          turn: turnNumber,
          by,
          answers,
          inputTokens,
          ms: performance.now() - started,
        });
        return { kind: 'answered', answers, spent };
      };

      // Each pass asks for an answer; one the developer drops in review asks again.
      for (;;) {
        const turnAnswer: TurnAnswer =
          hooks !== undefined
            ? await hooks.answer({ round, turn: turnNumber, request })
            : { by: 'model' };

        if ('repickFrom' in turnAnswer) return repick(turnAnswer);
        if (turnAnswer.by === 'you') {
          const answers = answersFromYou(request, turnAnswer.answers);
          if (typeof answers === 'string') return fail(new Error(answers));
          return answerAs({ kind: 'you' }, answers, 0);
        }

        const resolved = modelFor(turnAnswer.model);
        if (typeof resolved === 'string') return fail(new Error(resolved));
        const oversized = tooManyOptions(request, resolved.capabilities.choiceQuestions.maxOptions);
        if (oversized !== undefined) return fail(new Error(oversized));

        if (usage.inputTokens + spent.inputTokens >= inputTokenBudget) {
          emit({ type: 'turn.dropped', runId, round, turn: turnNumber, reason: 'budget' });
          return { kind: 'budget', spent };
        }

        const requested = await requestAnswers(resolved, request, info => {
          emit({ type: 'turn.retrying', runId, round, turn: turnNumber, ...info });
        }).catch((error: unknown) => ({ error }));
        if ('error' in requested) return fail(requested.error);
        const { answers, inputTokens } = requested;
        spent = addUsage(spent, { inputTokens, requests: 1 });
        const by = { kind: 'model', name: resolved.name, endpoint: resolved.endpoint } as const;

        if (turnAnswer.shouldReview !== true || hooks === undefined) {
          return answerAs(by, answers, inputTokens);
        }
        emit({
          type: 'turn.suggested',
          runId,
          round,
          turn: turnNumber,
          by,
          answers,
          inputTokens,
          ms: performance.now() - started,
        });
        const choices = Object.fromEntries(
          Object.entries(answers).map(([key, answer]) => [key, answer.choice]),
        );
        const review = await hooks.review({ round, turn: turnNumber, request, choices });
        if ('repickFrom' in review) return repick(review);
        if ('reopen' in review) {
          emit({ type: 'turn.reopened', runId, round, turn: turnNumber });
          continue;
        }
        return answerAs(by, answers, inputTokens);
      }
    };

    const answer = async (
      request: DecisionRequest,
      usage: Usage,
      optionInfo: OptionInfoByQuestion,
    ): Promise<TurnReply> => {
      turn += 1;
      const replayed = replay[turn - 1];
      if (replayed !== undefined) {
        if (JSON.stringify(replayed.request) !== JSON.stringify(request)) {
          throw new Error(`turn ${turn}, picked again, asked another question than before`);
        }
        asked.push(replayed);
        return { ...replayed.ending, spent: NOTHING_SPENT };
      }
      const reply = await ask(turn, request, usage, optionInfo);
      if (reply.kind === 'answered' || reply.kind === 'failed') {
        asked.push({ request, ending: reply });
      }
      return reply;
    };

    return {
      answer,
      /** The turns before `turn`, each as it ended: what a re-pick from it ends them with again. */
      askedBefore: (turn: number): AskedTurn[] => asked.slice(0, turn - 1),
    };
  };

  return { forPick };
};
