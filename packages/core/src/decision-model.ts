// The decision model: any `/v1/systemone` server (a local Ollama, TypeSafe, OpenRouter).
import { z } from 'zod';
import type { Context } from './task.ts';

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

export type DecisionRequest = { state: Context; questions: Record<string, Question> };

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

/** How long to wait before each retry of a request that failed on the way (3 retries). */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** An outage or rate limit, which a later request may get past; any other refusal won't. */
const isTransient = (status: number) => status === 429 || (status >= 500 && status < 600);

/**
 * Asks choice questions about one state, in one request. Every option gets a probability, and a
 * question's sum to 1. The questions are answered together, so none may depend on another's
 * answer. Only input tokens are counted: decision models charge nothing for output.
 *
 * A request that can't reach the server, or is answered 429 or 5xx, is sent again after 1, 2
 * and 4 s.
 */
export const requestAnswers = async (
  { endpoint, name, apiKey }: DecisionModel,
  request: DecisionRequest,
  onRetry?: (info: { delayMs: number; status?: number; error?: string }) => void,
): Promise<{ answers: Record<string, Answer>; inputTokens: number }> => {
  const body = JSON.stringify({
    model: name,
    state: request.state,
    questions: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => [
        key,
        { type: 'choice', ...question },
      ]),
    ),
  });

  // A server's error text may echo the key back; it never reaches a message, the log or an event.
  const withoutKey = (text: string) =>
    apiKey === undefined || apiKey === '' ? text : text.replaceAll(apiKey, '[apiKey]');
  const messageOf = (error: unknown) =>
    withoutKey(error instanceof Error ? error.message : String(error));

  // The body is read here too: a connection that drops mid-body is as unreachable as a refused one.
  const post = async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      body,
    });
    return { status: response.status, isOk: response.ok, text: await response.text() };
  };

  const ask = async ([delay, ...laterDelays]: readonly number[]): ReturnType<
    typeof requestAnswers
  > => {
    const retry =
      delay === undefined
        ? undefined
        : async (info: { status?: number; error?: string }) => {
            onRetry?.({ delayMs: delay, ...info });
            await sleep(delay);
            return ask(laterDelays);
          };
    const reply = await post().catch((error: unknown) => ({ error }));
    if ('error' in reply) {
      if (retry !== undefined) return retry({ error: messageOf(reply.error) });
      const { error } = reply;
      throw new Error(`can't reach the decision model at ${endpoint}: ${messageOf(error)}`, {
        cause: error,
      });
    }
    if (!reply.isOk) {
      const message = `decision model answered ${reply.status}: ${withoutKey(reply.text)}`;
      if (isTooLarge(reply.status, reply.text)) throw new RequestTooLargeError(message);
      if (isTransient(reply.status) && retry !== undefined) return retry({ status: reply.status });
      throw new Error(message);
    }
    const { answers, usage } = ResponseSchema.parse(JSON.parse(reply.text));
    return { answers, inputTokens: usage.input_tokens };
  };

  return ask(RETRY_DELAYS_MS);
};
