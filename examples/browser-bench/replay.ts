// Replays a single request from a browser-bench trace against a decision model, comparing the
// recorded choice and probabilities with one or more live replays.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Answer,
  AnswerSchema,
  type ConfigFile,
  describeCriterion,
  EventSchema,
  LogEventSchema,
  QuestionSchema,
  type Request,
  type RequestEvent,
  RequestEventSchema,
  RequestSchema,
  type Response,
  ResponseSchema,
  readConfigFile,
  type TraceFile,
  TraceFileSchema,
} from './schema.ts';

export {
  type Answer,
  AnswerSchema,
  EventSchema,
  LogEventSchema,
  QuestionSchema,
  type Request,
  type RequestEvent,
  RequestEventSchema,
  RequestSchema,
  type Response,
  ResponseSchema,
  type TraceFile,
  TraceFileSchema,
};

export type OptionScore = {
  readonly key: string;
  readonly description: string;
  readonly probability: number;
  readonly isChosen: boolean;
};

export const getTopOptions = (
  criteria: Readonly<Record<string, unknown>>,
  probabilities: Readonly<Record<string, number>>,
  chosenKey: string | undefined,
  limit = 5,
): readonly OptionScore[] => {
  const entries = Object.entries(criteria).map(([key, crit]) => ({
    key,
    description: describeCriterion(crit),
    probability: probabilities[key] ?? 0,
    isChosen: key === chosenKey,
  }));
  entries.sort((a, b) => b.probability - a.probability);
  return entries.slice(0, limit);
};

export const formatOptionScores = (options: readonly OptionScore[]): string =>
  options
    .map(
      (opt, idx) =>
        `   ${idx + 1}. [${opt.key}] ${opt.description} (${opt.probability.toFixed(2)})${opt.isChosen ? ' ← chosen' : ''}`,
    )
    .join('\n');

export const parseTraceFile = (jsonString: string): TraceFile => {
  const parsed: unknown = JSON.parse(jsonString);
  return TraceFileSchema.parse(parsed);
};

export const formatReplayComparison = ({
  requestIndex,
  totalRequests,
  request,
  recordedResponse,
  replayedResponses,
}: {
  readonly requestIndex: number;
  readonly totalRequests: number;
  readonly request: Request;
  readonly recordedResponse?: Response;
  readonly replayedResponses: readonly {
    readonly answers: Readonly<Record<string, Answer>>;
    readonly inputTokens?: number;
  }[];
}): string => {
  const recordedAnswers = recordedResponse?.answers ?? {};
  const sections: string[] = [`Request ${requestIndex} of ${totalRequests}`];

  for (const [qKey, question] of Object.entries(request.questions)) {
    const instructionsStr =
      typeof question.instructions === 'string'
        ? question.instructions
        : JSON.stringify(question.instructions);
    sections.push(`Question "${qKey}": ${instructionsStr}`);

    const recordedAnswer = recordedAnswers[qKey];
    if (recordedAnswer !== undefined) {
      const topRecorded = getTopOptions(
        question.criteria,
        recordedAnswer.probabilities,
        recordedAnswer.choice,
      );
      sections.push(`Recorded top 5:
${formatOptionScores(topRecorded)}`);
    }

    replayedResponses.forEach((replayRes, idx) => {
      const answer = replayRes.answers[qKey];
      const tokenInfo =
        replayRes.inputTokens !== undefined ? ` (${replayRes.inputTokens} input tokens)` : '';
      if (answer !== undefined) {
        const topReplay = getTopOptions(question.criteria, answer.probabilities, answer.choice);
        sections.push(`Replay ${idx + 1}${tokenInfo}:
${formatOptionScores(topReplay)}`);
      } else {
        sections.push(`Replay ${idx + 1}${tokenInfo}: (no answer for "${qKey}")`);
      }
    });
  }

  return sections.join('\n\n');
};

/** Resends a trace request directly to a configured decision model. */
export const replay = async (
  request: Request,
  config: ConfigFile,
): Promise<{
  readonly answers: Readonly<Record<string, Answer>>;
  readonly inputTokens: number;
}> => {
  const { endpoint, name, apiKey } = config.decisionModel;
  const response = await fetch(endpoint, {
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`decision model answered ${response.status}: ${body}`);
  }

  const { answers, usage } = ResponseSchema.parse(await response.json());
  return { answers, inputTokens: usage?.input_tokens ?? 0 };
};

const parseCliArgs = (args: readonly string[]) => {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--')) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(arg, next);
        i++;
      } else {
        flags.set(arg, 'true');
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
};

const main = async () => {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));

  if (positional.length < 2) {
    process.stderr.write(
      'Usage: node projects/gut/examples/browser-bench/replay.ts <trace.json> <request number> [--config path] [--times 3]\n',
    );
    process.exit(1);
  }

  const [traceFileArg, requestNumArg] = positional;
  if (traceFileArg === undefined || requestNumArg === undefined) {
    process.stderr.write('Error: missing required positional arguments\n');
    process.exit(1);
  }

  const requestNum = Number(requestNumArg);
  if (!Number.isInteger(requestNum) || requestNum <= 0) {
    process.stderr.write(
      `Error: request number must be a positive integer, got "${requestNumArg}"\n`,
    );
    process.exit(1);
  }

  const timesArg = flags.get('--times') ?? '3';
  const times = Number(timesArg);
  if (!Number.isInteger(times) || times <= 0) {
    process.stderr.write(`Error: --times must be a positive integer, got "${timesArg}"\n`);
    process.exit(1);
  }

  const config = readConfigFile(flags.get('--config'));

  const jsonContent = readFileSync(resolve(traceFileArg), 'utf-8');
  const trace = parseTraceFile(jsonContent);

  const requestEvents = trace.events.filter((e): e is RequestEvent => e.kind === 'request');

  if (requestNum > requestEvents.length) {
    process.stderr.write(
      `Error: Request ${requestNum} out of range (trace has ${requestEvents.length} requests)\n`,
    );
    process.exit(1);
  }

  const targetEvent = requestEvents[requestNum - 1];
  if (targetEvent === undefined) {
    process.stderr.write(`Error: Request ${requestNum} not found\n`);
    process.exit(1);
  }

  const recordedResponseParsed = ResponseSchema.safeParse(targetEvent.response);
  const recordedResponse = recordedResponseParsed.success ? recordedResponseParsed.data : undefined;

  const replayedResponses: Array<{
    readonly answers: Readonly<Record<string, Answer>>;
    readonly inputTokens: number;
  }> = [];

  for (let i = 0; i < times; i++) {
    const res = await replay(targetEvent.request, config);
    replayedResponses.push(res);
  }

  const output = formatReplayComparison({
    requestIndex: requestNum,
    totalRequests: requestEvents.length,
    request: targetEvent.request,
    recordedResponse,
    replayedResponses,
  });

  process.stdout.write(`${output}\n`);
};

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch(err => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
