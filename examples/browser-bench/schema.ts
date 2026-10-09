import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const QuestionSchema = z.object({
  type: z.string().optional(),
  instructions: z.union([z.string(), z.record(z.string(), z.unknown())]),
  criteria: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.unknown())])),
});
export type Question = z.infer<typeof QuestionSchema>;

export const RequestSchema = z.object({
  state: z.record(z.string(), z.unknown()),
  questions: z.record(z.string(), QuestionSchema),
});
export type Request = z.infer<typeof RequestSchema>;
export const AnswerSchema = z.object({
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const ResponseSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
});
export type Response = z.infer<typeof ResponseSchema>;
export const TraceRecordSchema = z
  .object({
    task: z.string(),
    variant: z.string(),
    rep: z.number(),
    success: z.boolean().optional(),
    status: z.string().optional(),
    reason: z.string().optional(),
    usage: z.object({ requests: z.number(), inputTokens: z.number() }).optional(),
    wallClockMs: z.number().optional(),
  })
  .passthrough();
export type TraceRecord = z.infer<typeof TraceRecordSchema>;

export const RequestEventSchema = z.object({
  kind: z.literal('request'),
  request: RequestSchema,
  response: z.unknown(),
});
export type RequestEvent = z.infer<typeof RequestEventSchema>;

export const LogEventSchema = z.object({
  kind: z.literal('log'),
  line: z.string(),
});
export type LogEvent = z.infer<typeof LogEventSchema>;

export const EventSchema = z.discriminatedUnion('kind', [RequestEventSchema, LogEventSchema]);
export type Event = z.infer<typeof EventSchema>;

export const TraceFileSchema = z.object({
  record: TraceRecordSchema,
  events: z.array(EventSchema),
});
export type TraceFile = z.infer<typeof TraceFileSchema>;

const hasElement = (val: object): val is { readonly element: unknown } => 'element' in val;

export const describeCriterion = (crit: unknown): string => {
  if (typeof crit === 'string') return crit;
  if (
    typeof crit === 'object' &&
    crit !== null &&
    hasElement(crit) &&
    typeof crit.element === 'string'
  ) {
    return crit.element;
  }
  return JSON.stringify(crit);
};

/** What the bench reads of a gut config file: where the decision model is, and what it takes. */
const ConfigFileSchema = z.object({
  decisionModel: z.looseObject({
    endpoint: z.string(),
    name: z.string(),
    apiKey: z.string().optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** `--config`'s file (a leading `~/` is the home directory), else ~/gut.config.json. */
export const readConfigFile = (path = '~/gut.config.json'): ConfigFile => {
  const resolved = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
  return ConfigFileSchema.parse(JSON.parse(readFileSync(resolved, 'utf8')));
};
