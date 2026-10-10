// Hooks an inspector attaches to a run: who answers each turn, and the event stream. Also the
// protocol between the CLI and the inspector page: session events and the page's actions.
import { z } from 'zod';
import { type DecisionModel, DecisionModelSchema, type DecisionRequest } from './decision-model.ts';
import {
  type OpAddress,
  type OpChoiceNode,
  type OpTreeNode,
  type OptionInfo,
  PROTOCOL,
  type RunEvent,
  RunEventSchema,
} from './events.ts';

export { loadConfig, parseConfig } from './config.ts';
export { answersFromYou } from './turns.ts';
export type {
  DecisionModel,
  DecisionRequest,
  OpAddress,
  OpChoiceNode,
  OpTreeNode,
  OptionInfo,
  RunEvent,
};
export { DecisionModelSchema, PROTOCOL, RunEventSchema };

/** Symbol the CLI sets on `globalThis` before importing a task; `initGut` reads it once. */
export const INSPECTOR_KEY = Symbol.for('gut.run.inspector');

/**
 * Who answers one turn: the model (the run's, or one supplied here), the developer with answers
 * keyed by question → criterion, or a re-pick of this round.
 */
export type TurnAnswer =
  | { by: 'model'; model?: DecisionModel }
  | { by: 'you'; answers: Readonly<Record<string, string>> }
  | { repick: true };

/** Hooks an inspector returns for one run. Tagged values only; never throw across this boundary. */
export type RunHooks = {
  /** Synchronous, never awaited. */
  onEvent: (event: RunEvent) => void;
  answer: (turn: { round: number; turn: number; request: DecisionRequest }) => Promise<TurnAnswer>;
  beforePick: (round: { round: number }) => Promise<{ maxOptions: number }>;
  beforeInvoke: (step: { round: number; step: string }) => Promise<'invoke' | 'repick'>;
};

/** What `globalThis[INSPECTOR_KEY]` holds when an inspector is attached. */
export type InspectorGlobal = {
  protocol: number;
  attach: (run: { runId: string }) => RunHooks;
};

/** A decision model as people see it: never its key. */
const ModelInfoSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  maxOptions: z.number().int().positive(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/**
 * Play: the model answers every turn and every picked step runs. Step: the run waits for the
 * developer at every turn and before every step.
 */
const ModeSchema = z.enum(['play', 'step']);

export type Mode = z.infer<typeof ModeSchema>;

/**
 * What the CLI adds to the run events, in the same log, so a reload rebuilds the session too: the
 * mode, the model set in the page, and each decision the run waits on until it is resolved.
 */
export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.started'),
    protocol: z.number().int(),
    /** The task file, as given to `gut run`. */
    task: z.string(),
    mode: ModeSchema,
  }),
  z.object({ type: z.literal('session.mode'), mode: ModeSchema }),
  /** The model set in the page, used by every run that has none of its own. */
  z.object({ type: z.literal('session.model'), model: ModelInfoSchema.nullable() }),
  z.object({
    type: z.literal('decision.pending'),
    id: z.string(),
    runId: z.string(),
    round: z.number().int().positive(),
    /** A turn waiting for answers, or a picked step waiting to run. */
    on: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('turn'), turn: z.number().int().positive() }),
      z.object({ kind: z.literal('step'), step: z.string() }),
    ]),
  }),
  z.object({
    type: z.literal('decision.resolved'),
    id: z.string(),
    by: z.enum(['you', 'model', 'run', 'repick']),
  }),
  /** The task's top-level code finished, or threw; the record stays until the CLI exits. */
  z.object({ type: z.literal('session.ended'), error: z.string().optional() }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;

/** Everything the page reads from `GET /api/events`. */
export const InspectorEventSchema = z.union([RunEventSchema, SessionEventSchema]);

export type InspectorEvent = z.infer<typeof InspectorEventSchema>;

/**
 * What the page asks of the CLI (`POST /api/actions`). A decision is answered by its id; once it is
 * resolved, a later action on it is refused (409), so the first tab to act wins.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  /** Answer a waiting turn yourself: question key → criterion key. */
  z.object({
    type: z.literal('answer'),
    decision: z.string(),
    answers: z.record(z.string(), z.string()),
  }),
  z.object({ type: z.literal('askModel'), decision: z.string() }),
  z.object({ type: z.literal('run'), decision: z.string() }),
  /** Drop this round's pick and ask its turns afresh. */
  z.object({ type: z.literal('repick'), decision: z.string() }),
  /** A model for runs that have none; its key stays in the CLI's memory. */
  z.object({
    type: z.literal('setModel'),
    model: z.object({
      endpoint: z.url(),
      name: z.string().min(1),
      apiKey: z.string().optional(),
      maxOptions: z.number().int().min(2).optional(),
    }),
  }),
  /** Drop the page's model: runs without their own go back to a person answering every turn. */
  z.object({ type: z.literal('clearModel') }),
  /**
   * Use a gut config's model for runs that have none, read by the CLI: a path (`~/` and paths
   * relative to where gut started are fine), or a file's text the page read.
   */
  z.object({
    type: z.literal('loadConfig'),
    from: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('path'), path: z.string().min(1) }),
      z.object({ kind: z.literal('text'), text: z.string() }),
    ]),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;
