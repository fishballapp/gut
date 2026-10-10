// Events emitted during a gut run, observed by stderr and any attached inspector.
import { z } from 'zod';
import { isOp, type Ops } from './ops.ts';

/**
 * Protocol version for the inspector event schema. Bump this whenever a change would break older
 * readers (the CLI or the page), so they fail early naming both versions.
 */
export const PROTOCOL = 1;

export const OpAddressSchema = z.object({
  keys: z.array(z.string()),
  choice: z.number().int().nonnegative().optional(),
});
export type OpAddress = z.infer<typeof OpAddressSchema>;

const JsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

// ponytail: a context holding NaN or Infinity (a number, but not JSON) fails this schema, and so
// does an `inputTokenBudget` of Infinity. No task does either; the CLI's validation names the event.
const ContextSchema = z.object({ goal: z.string() }).catchall(JsonSchema);

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});

const QuestionSchema = z.object({
  instructions: z.string(),
  criteria: z.record(z.string(), z.string()),
});

const AnswerSchema = z.object({
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
});

const DecisionRequestSchema = z.object({
  state: ContextSchema,
  questions: z.record(z.string(), QuestionSchema),
});

export type OpTreeNode =
  | {
      kind: 'group';
      address: OpAddress;
      description: string;
      children: OpTreeNode[];
    }
  | {
      kind: 'op';
      address: OpAddress;
      description: string;
    }
  | {
      kind: 'choices';
      address: OpAddress;
      description: string;
      children: OpChoiceNode[];
    }
  | {
      kind: 'choice';
      address: OpAddress;
      label: string;
    };

export type OpChoiceNode = Extract<OpTreeNode, { kind: 'choice' }>;

export const OpTreeNodeSchema: z.ZodType<OpTreeNode> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('group'),
      address: OpAddressSchema,
      description: z.string(),
      children: z.array(OpTreeNodeSchema),
    }),
    z.object({
      kind: z.literal('op'),
      address: OpAddressSchema,
      description: z.string(),
    }),
    z.object({
      kind: z.literal('choices'),
      address: OpAddressSchema,
      description: z.string(),
      children: z.array(
        z.object({
          kind: z.literal('choice'),
          address: OpAddressSchema,
          label: z.string(),
        }),
      ),
    }),
    z.object({
      kind: z.literal('choice'),
      address: OpAddressSchema,
      label: z.string(),
    }),
  ]),
);

/** Builds op-tree nodes from the ops as written, skipping falsy entries. */
export const toOpTree = (ops: Ops, prefix: readonly string[] = []): OpTreeNode[] =>
  Object.entries(ops).flatMap(([key, entry]): OpTreeNode[] => {
    if (!isOp(entry)) return [];
    const keys = [...prefix, key];
    if (entry.kind === 'node') {
      return [
        {
          kind: 'group',
          address: { keys },
          description: entry.description,
          children: toOpTree(entry.ops, keys),
        },
      ];
    }
    if (entry.choices !== undefined) {
      return [
        {
          kind: 'choices',
          address: { keys },
          description: entry.description,
          children: entry.choices.map((choice, i) => ({
            kind: 'choice' as const,
            address: { keys, choice: i },
            label: choice.label,
          })),
        },
      ];
    }
    return [
      {
        kind: 'op',
        address: { keys },
        description: entry.description,
      },
    ];
  });

/** Mirrors `TaskResult`: achieved, or halted with a reason (and `error` when the reason is error). */
export const TaskResultSchema = z.union([
  z.object({
    status: z.literal('achieved'),
    steps: z.array(z.string()),
    context: ContextSchema.nullable(),
    usage: UsageSchema,
  }),
  z.object({
    status: z.literal('halted'),
    reason: z.enum(['noOptions', 'budget', 'stalled']),
    steps: z.array(z.string()),
    context: ContextSchema.nullable(),
    usage: UsageSchema,
  }),
  z.object({
    status: z.literal('halted'),
    reason: z.literal('error'),
    error: z.string(),
    steps: z.array(z.string()),
    context: ContextSchema.nullable(),
    usage: UsageSchema,
  }),
]);

export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.started'),
    runId: z.string(),
    model: z
      .object({
        name: z.string(),
        endpoint: z.string(),
        maxOptions: z.number().int().positive(),
      })
      .nullable(),
    inputTokenBudget: z.number(),
    isGoalCheckedInCode: z.boolean(),
  }),
  z.object({
    type: z.literal('tick.observed'),
    runId: z.string(),
    tick: z.number().int().positive(),
    context: ContextSchema,
    ops: z.array(OpTreeNodeSchema),
  }),
  z.object({
    type: z.literal('tick.goalChecked'),
    runId: z.string(),
    tick: z.number().int().positive(),
    achieved: z.boolean(),
    ms: z.number(),
  }),
  z.object({
    type: z.literal('pick.started'),
    runId: z.string(),
    tick: z.number().int().positive(),
    maxOptions: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('turn.asked'),
    runId: z.string(),
    tick: z.number().int().positive(),
    turn: z.number().int().positive(),
    request: DecisionRequestSchema,
  }),
  z.object({
    type: z.literal('turn.retrying'),
    runId: z.string(),
    tick: z.number().int().positive(),
    turn: z.number().int().positive(),
    delayMs: z.number(),
    status: z.number().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('turn.answered'),
    runId: z.string(),
    tick: z.number().int().positive(),
    turn: z.number().int().positive(),
    by: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('you') }),
      z.object({
        kind: z.literal('model'),
        name: z.string(),
        endpoint: z.string(),
      }),
    ]),
    answers: z.record(z.string(), AnswerSchema),
    inputTokens: z.number().int().nonnegative(),
    ms: z.number(),
  }),
  z.object({
    type: z.literal('turn.failed'),
    runId: z.string(),
    tick: z.number().int().positive(),
    turn: z.number().int().positive(),
    error: z.string(),
    isTooLarge: z.boolean(),
  }),
  z.object({
    type: z.literal('turn.dropped'),
    runId: z.string(),
    tick: z.number().int().positive(),
    turn: z.number().int().positive(),
    reason: z.enum(['repick', 'budget']),
  }),
  z.object({
    type: z.literal('pick.abandoned'),
    runId: z.string(),
    tick: z.number().int().positive(),
    usage: UsageSchema,
  }),
  z.object({
    type: z.literal('tick.picked'),
    runId: z.string(),
    tick: z.number().int().positive(),
    step: z.string(),
    probabilities: z.array(z.number()),
    tokens: z.number().int().nonnegative(),
    ms: z.number(),
  }),
  z.object({
    type: z.literal('step.invoked'),
    runId: z.string(),
    tick: z.number().int().positive(),
    step: z.string(),
    ms: z.number(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('run.ended'),
    runId: z.string(),
    result: TaskResultSchema,
  }),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
