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
import type { RunHooks, TurnAnswer } from './inspector.ts';
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
const NOTHING_SPENT = { inputTokens: 0, isModel: false };

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
  /** Asks one pick's turns, numbered from 1: a re-pick starts again at turn 1. */
  const forPick = (round: number) => {
    let turn = 0;

    const answer = async (
      request: DecisionRequest,
      usage: Usage,
      optionInfo: OptionInfoByQuestion,
    ): Promise<TurnReply> => {
      turn += 1;
      const turnNumber = turn;
      emit({ type: 'turn.asked', runId, round, turn: turnNumber, request, optionInfo });
      const started = performance.now();

      const turnAnswer: TurnAnswer =
        hooks !== undefined
          ? await hooks.answer({ round, turn: turnNumber, request })
          : { by: 'model' };

      /** Records the turn as failed, then throws: a turn ends answered, failed or dropped. */
      const fail = (message: string): never => {
        emit({
          type: 'turn.failed',
          runId,
          round,
          turn: turnNumber,
          error: message,
          isTooLarge: false,
        });
        throw new Error(message);
      };

      /** Records a re-pick: the turn is dropped, with what the model spent on it if it was asked. */
      const repick = (spent: { inputTokens: number; isModel: boolean }): TurnReply => {
        emit({ type: 'turn.dropped', runId, round, turn: turnNumber, reason: 'repick' });
        return { kind: 'repick', ...spent };
      };

      /** Records your answers, with what the model spent if it answered first. */
      const answerAsYou = (
        chosen: Readonly<Record<string, string>>,
        spent: { inputTokens: number; isModel: boolean },
      ): TurnReply => {
        const answers = answersFromYou(request, chosen);
        if (typeof answers === 'string') return fail(answers);
        emit({
          type: 'turn.answered',
          runId,
          round,
          turn: turnNumber,
          by: { kind: 'you' },
          answers,
          inputTokens: spent.inputTokens,
          ms: performance.now() - started,
        });
        return { kind: 'answered', answers, ...spent };
      };

      if ('repick' in turnAnswer) return repick(NOTHING_SPENT);
      if (turnAnswer.by === 'you') return answerAsYou(turnAnswer.answers, NOTHING_SPENT);

      // The model to ask: one the inspector supplies, checked like a config's, else the run's own.
      const resolved = (() => {
        if (turnAnswer.model === undefined) {
          return model ?? fail('no decision model to answer this turn');
        }
        const parsed = DecisionModelSchema.safeParse(turnAnswer.model);
        return parsed.success
          ? parsed.data
          : fail(`invalid decision model: ${z.prettifyError(parsed.error)}`);
      })();
      const oversized = tooManyOptions(request, resolved.capabilities.choiceQuestions.maxOptions);
      if (oversized !== undefined) return fail(oversized);

      if (usage.inputTokens >= inputTokenBudget) {
        emit({ type: 'turn.dropped', runId, round, turn: turnNumber, reason: 'budget' });
        return { kind: 'budget' };
      }

      const { answers, inputTokens } = await (async () => {
        try {
          return await requestAnswers(resolved, request, info => {
            emit({ type: 'turn.retrying', runId, round, turn: turnNumber, ...info });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({
            type: 'turn.failed',
            runId,
            round,
            turn: turnNumber,
            error: message,
            isTooLarge: error instanceof RequestTooLargeError,
          });
          throw error;
        }
      })();
      const by = { kind: 'model', name: resolved.name, endpoint: resolved.endpoint } as const;
      const spent = { inputTokens, isModel: true };
      const answerAsModel = (): TurnReply => {
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
        return { kind: 'answered', answers, ...spent };
      };

      if (turnAnswer.shouldReview !== true || hooks === undefined) return answerAsModel();
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
      if ('repick' in review) return repick(spent);
      if (review.by === 'you') return answerAsYou(review.answers, spent);
      return answerAsModel();
    };

    return { answer };
  };

  return { forPick };
};
