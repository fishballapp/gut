// The decision model: any `/v1/systemone` server (a local Ollama, TypeSafe, OpenRouter).
import { z } from 'zod';

/** The most options one choice question takes, unless configured: TypeSafe's limit for Jev. */
export const DEFAULT_MAX_OPTIONS = 255;

/**
 * Where the decision model is and what it can take: gut.config.json's `decisionModel`. Strict, so
 * a key gut doesn't read (or a typo) fails instead of being ignored.
 */
export const DecisionModelSchema = z.strictObject({
  /** A `/v1/systemone` server, e.g. a local Ollama's `http://localhost:11434/v1/systemone`. */
  endpoint: z.url(),
  /** The model the server runs, e.g. `clef-flash`, or `~typesafe/jev-latest` on OpenRouter. */
  name: z.string(),
  /** Sent as `Authorization: Bearer <apiKey>`, as TypeSafe's API and OpenRouter both take it. */
  apiKey: z.string().optional(),
  /** What the model can take; every field has a default. */
  capabilities: z
    .strictObject({
      /** Whether its state may hold images. Nothing in gut sends one yet. */
      image: z.boolean().default(false),
      choiceQuestions: z
        .strictObject({
          /** The most options one choice question takes; Ollama takes 26. */
          maxOptions: z.int().min(2).default(DEFAULT_MAX_OPTIONS),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type DecisionModel = z.infer<typeof DecisionModelSchema>;

export type Question = { instructions: string; criteria: Record<string, string> };

type Request = { state: unknown; questions: Record<string, Question> };

/**
 * The server refused a request as too large for it (Ollama: a body over 64 KiB, or a prompt past
 * the model's context; Jev: past 64k tokens). Refusals are not billed, so the caller splits and
 * asks again instead of estimating sizes per model.
 */
export class RequestTooLargeError extends Error {}

const isTooLarge = (status: number, body: string) =>
  status === 413 ||
  (status === 400 && /context|max_tokens_exceeded|too large|too long/i.test(body));

/** A question's answer: the option chosen, and every option's probability. */
const AnswerSchema = z.object({
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
});

export type Answer = z.infer<typeof AnswerSchema>;

const ResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.int().nonnegative() }),
});

/**
 * Asks choice questions about one state, in one request. Every option gets a probability, and a
 * question's sum to 1. The questions are answered together, so none may depend on another's
 * answer. Only input tokens are counted: decision models charge nothing for output.
 */
export const requestAnswers = async (
  { endpoint, name, apiKey }: DecisionModel,
  request: Request,
) => {
  const response = await (async () => {
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({
          model: name,
          state: request.state,
          questions: Object.fromEntries(
            Object.entries(request.questions).map(([key, question]) => [
              key,
              { type: 'choice', ...question },
            ]),
          ),
        }),
      });
    } catch (error) {
      throw new Error(
        `can't reach the decision model at ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  })();
  if (!response.ok) {
    const body = await response.text();
    const message = `decision model answered ${response.status}: ${body}`;
    throw isTooLarge(response.status, body)
      ? new RequestTooLargeError(message)
      : new Error(message);
  }
  const { answers, usage } = ResponseSchema.parse(await response.json());
  return { answers, inputTokens: usage.input_tokens };
};
