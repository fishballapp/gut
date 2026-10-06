// How a tick picks its step: the tick's ops are shown to the decision model level by level (a group,
// an op, its choice) until a step is picked or the goal is met. A level longer than one question
// takes is asked by its op's ListStrategy (list-strategy.ts), else by `ListStrategy.bundle`.
import {
  type Answer,
  type DecisionModel,
  type Question,
  RequestTooLargeError,
  requestAnswers,
} from './decision-model.ts';
import { knockoutInPagesOf, ListStrategy, type Questions } from './list-strategy.ts';
import { isOp, type Ops } from './ops.ts';
import type { Context, Usage } from './task.ts';
import { mapLeaves, type Tree } from './tree.ts';

/** An executable move, named by its key path, e.g. `openLink("Rome")`. */
export type Step = { name: string; invoke: () => unknown };

type StepTree = Tree<
  { description: string; step: Step },
  { description: string; strategy?: ListStrategy }
>;

/**
 * The tree a pick walks: groups as written, and an op with choices as a node of its choices, so a
 * long list can be asked as a level of its own. Every leaf is a named step, and a node with no step
 * under it is dropped.
 */
const toStepTrees = (ops: Ops, parentName?: string): StepTree[] =>
  Object.entries(ops).flatMap(([key, op]): StepTree[] => {
    if (!isOp(op)) return [];
    const name = parentName === undefined ? key : `${parentName}.${key}`;
    if (op.kind === 'node') {
      const children = toStepTrees(op.ops, name);
      if (children.length === 0) return [];
      return [{ kind: 'node', description: op.description, children }];
    }
    if (op.choices === undefined) {
      return [{ kind: 'leaf', description: op.description, step: { name, invoke: op.invoke } }];
    }
    if (op.choices.length === 0) return [];
    const children = op.choices.map(
      ({ label, invoke }): StepTree => ({
        kind: 'leaf',
        description: label,
        step: { name: `${name}(${JSON.stringify(label)})`, invoke },
      }),
    );
    return [{ kind: 'node', description: op.description, strategy: op.strategy, children }];
  });

/**
 * Where a pick stands: the action chosen so far, the trees still to choose among, and how to ask
 * them when they don't fit one question.
 */
type Level = { trail: readonly string[]; trees: readonly StepTree[]; strategy?: ListStrategy };

/** What the model reads as one option, and what choosing it leads to: a step, or another level. */
type Option =
  | { kind: 'step'; description: string; step: Step }
  | { kind: 'level'; description: string; level: Level };

/** A level's options: every step under it if they fit in one question, else its trees. */
const optionsAt = ({ trail, trees }: Level, maxOptions: number): Option[] => {
  const leaves = mapLeaves(
    trees,
    ({ description, step }, path): Option => ({
      kind: 'step',
      description: [...path.map(node => node.description), description].join(' › '),
      step,
    }),
  );
  if (leaves.length <= maxOptions) return leaves;
  return trees.map((tree): Option => {
    if (tree.kind === 'leaf') {
      return { kind: 'step', description: tree.description, step: tree.step };
    }
    const level = {
      trail: [...trail, tree.description],
      trees: tree.children,
      strategy: tree.strategy,
    };
    return { kind: 'level', description: tree.description, level };
  });
};

/**
 * Whether the goal is met is its own two-way question, asked in the tick's first request beside the
 * move. Offered as one option among many moves, it drew the probability whenever no move fitted.
 */
const goalQuestion = (goal: string): Question => ({
  instructions: 'Is the goal achieved?',
  criteria: { achieved: `Goal achieved: ${goal}`, notYet: 'Goal not achieved yet' },
});

const nextQuestion = (
  trail: readonly string[],
  options: readonly { description: string }[],
): Question => ({
  instructions:
    trail.length === 0
      ? 'What should happen next?'
      : `Current action: ${trail.join(' › ')}. Which one?`,
  criteria: Object.fromEntries(options.map((option, i) => [`o${i + 1}`, option.description])),
});

/** What every request in a run shares. */
export type Asker = { decisionModel: DecisionModel; inputTokenBudget: number };

type Ending = { status: 'achieved' } | { status: 'halted'; reason: 'budget' };

/** Ends a pick from whichever request finds the goal met or the budget spent. */
class PickEnded extends Error {
  readonly ending: Ending;
  constructor(ending: Ending) {
    super(ending.status);
    this.ending = ending;
  }
}

/** The option the model chose, by the key it answered with. */
const chosenOption = <T>(options: readonly T[], answer: Answer | undefined) => {
  if (answer === undefined) throw new Error('the decision model skipped a question');
  const option = new Map(options.map((option, i) => [`o${i + 1}`, option])).get(answer.choice);
  if (option === undefined) throw new Error(`the decision model chose "${answer.choice}"`);
  return { option, probability: answer.probabilities[answer.choice] ?? 0 };
};

/**
 * One pick's decisions, made one request at a time. It owns what the pick has spent, whether the
 * goal is still to be asked, and the probabilities to log. Requests are sequential: strategies
 * await each `choose` before the next.
 */
const createPickSession = ({
  asker,
  context,
  usage: initialUsage,
  isGoalAsked,
}: {
  asker: Asker;
  context: Context;
  usage: Usage;
  isGoalAsked: boolean;
}) => {
  let usage = initialUsage;
  let isGoalPending = isGoalAsked;
  const probabilities: number[] = [];

  /** Reads the goal question's answer: a met goal ends the pick. */
  const settleGoal = (answer: Answer | undefined) => {
    if (answer?.choice === 'achieved') {
      probabilities.push(answer.probabilities.achieved ?? 0);
      throw new PickEnded({ status: 'achieved' });
    }
    if (answer?.choice !== 'notYet') {
      throw new Error(`the decision model answered the goal with "${answer?.choice}"`);
    }
    isGoalPending = false;
  };

  /** Sends one request, if the budget allows, with the goal question while it is pending. */
  const send = async (questions: Record<string, Question>) => {
    if (usage.inputTokens >= asker.inputTokenBudget) {
      throw new PickEnded({ status: 'halted', reason: 'budget' });
    }
    const { answers, inputTokens } = await requestAnswers(asker.decisionModel, {
      state: context,
      questions: {
        ...(isGoalPending ? { achieved: goalQuestion(context.goal) } : {}),
        ...questions,
      },
    });
    usage = { inputTokens: usage.inputTokens + inputTokens, requests: usage.requests + 1 };
    if (isGoalPending) settleGoal(answers.achieved);
    return answers;
  };

  /**
   * Chooses among 1 to `maxOptions` options in one request; the tick's first carries the goal. A
   * lone option needs no question, so it sends nothing.
   */
  const choose = async <T extends { description: string }>(
    options: readonly T[],
    trail: readonly string[],
  ): Promise<T> => {
    const [first] = options;
    if (first === undefined) throw new Error('asked to choose among no options');
    if (options.length === 1) {
      probabilities.push(1);
      return first;
    }
    const answers = await send({ next: nextQuestion(trail, options) });
    // Picks run whatever their probability: no threshold separated right picks from wrong ones, so
    // they are logged for the caller, and stalls and the budget stop a run instead.
    const { option, probability } = chosenOption(options, answers.next);
    probabilities.push(probability);
    return option;
  };

  /** A tick with nothing to choose still asks the goal, alone, before its step runs. */
  const checkGoal = async () => {
    if (isGoalPending) await send({});
  };

  return { choose, checkGoal, snapshot: () => ({ usage, probabilities: [...probabilities] }) };
};

type PickSession = ReturnType<typeof createPickSession>;

/**
 * The `ask` a level's strategy gets: one `choose` per question. A question the server refuses as
 * too large is split into a knockout of its halves: refused requests are not billed, so no size is
 * estimated up front, and a refused pair fails.
 */
const questionsAt = (
  session: PickSession,
  trail: readonly string[],
  maxOptions: number,
): Questions => {
  const ask: Questions['ask'] = async options => {
    try {
      return await session.choose(options, trail);
    } catch (error) {
      if (!(error instanceof RequestTooLargeError) || options.length <= 2) throw error;
      // ponytail: every refusal costs a round trip; learn a size from `usage` if they show up in timings.
      return knockoutInPagesOf(Math.ceil(options.length / 2))(options, { ask, maxOptions });
    }
  };
  return { ask, maxOptions };
};

/** Asks level by level until a step is picked. */
const pickAt = async (session: PickSession, level: Level, maxOptions: number): Promise<Step> => {
  const option = await (level.strategy ?? ListStrategy.bundle)(
    optionsAt(level, maxOptions),
    questionsAt(session, level.trail, maxOptions),
  );
  if (option.kind === 'step') return option.step;
  return pickAt(session, option.level, maxOptions);
};

/**
 * Picks the tick's step among its ops, or finds the goal met when `isGoalAsked`; no ops halts the
 * run. Whatever ends the pick, it reports what the pick spent, a failure included.
 */
export const pick = async ({
  asker,
  context,
  ops,
  usage,
  isGoalAsked,
}: {
  asker: Asker;
  context: Context;
  ops: Ops;
  usage: Usage;
  isGoalAsked: boolean;
}): Promise<
  { usage: Usage } & (
    | { status: 'picked'; step: Step; probabilities: number[] }
    | { status: 'achieved'; probabilities: number[] }
    | { status: 'halted'; reason: 'noOptions' | 'budget' }
    | { status: 'failed'; error: unknown }
  )
> => {
  const trees = toStepTrees(ops);
  if (trees.length === 0) return { status: 'halted', reason: 'noOptions', usage };
  const session = createPickSession({ asker, context, usage, isGoalAsked });
  const maxOptions = asker.decisionModel.capabilities.choiceQuestions.maxOptions;
  try {
    const step = await pickAt(session, { trail: [], trees }, maxOptions);
    await session.checkGoal();
    return { status: 'picked', step, ...session.snapshot() };
  } catch (error) {
    const { usage: spent, probabilities } = session.snapshot();
    if (!(error instanceof PickEnded)) return { status: 'failed', error, usage: spent };
    if (error.ending.status === 'achieved') {
      return { status: 'achieved', probabilities, usage: spent };
    }
    return { ...error.ending, usage: spent };
  }
};
