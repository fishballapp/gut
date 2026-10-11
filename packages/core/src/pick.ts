// How a round picks its step: the round's ops are shown to the decision model level by level (a group,
// an op, its choice) until a step is picked or the goal is met. Closed groups open one by one
// (smallest first) within the question limit; a level longer than one question takes is asked by
// its op's ListStrategy (list-strategy.ts), else by `ListStrategy.bundle`.
import type { Merge } from 'type-fest';
import {
  type Answer,
  type DecisionRequest,
  type Question,
  RequestTooLargeError,
} from './decision-model.ts';
import { editTrees } from './edits.ts';
import type { Edit, OpAddress, OptionInfo, OptionInfoByQuestion } from './events.ts';
import { knockoutInPagesOf, ListStrategy, type Questions } from './list-strategy.ts';
import { isOp, type Ops } from './ops.ts';
import type { Context, Usage } from './task.ts';
import { keepLeaves, mapLeaves, pruneTree, type Tree } from './tree.ts';

/** An executable move, named by its key path, e.g. `openLink("Rome")`, and where it is in the ops. */
export type Step = { name: string; address: OpAddress; invoke: () => unknown };

export type StepTree = Tree<
  { description: string; step: Step },
  { description: string; address: OpAddress; strategy?: ListStrategy; isGroup?: true }
>;

/**
 * The tree a pick walks: groups as written, and an op with choices as a node of its choices, so a
 * long list can be asked as a level of its own. Every leaf is a named step, and a node with no step
 * under it is dropped.
 */
const toStepTrees = (ops: Ops, parentKeys: readonly string[] = []): StepTree[] =>
  Object.entries(ops).flatMap(([key, op]): StepTree[] => {
    if (!isOp(op)) return [];
    const keys = [...parentKeys, key];
    const name = keys.join('.');
    if (op.kind === 'node') {
      const children = toStepTrees(op.ops, keys);
      if (children.length === 0) return [];
      const address = { keys };
      return [{ kind: 'node', description: op.description, address, children, isGroup: true }];
    }
    if (op.choices === undefined) {
      const step = { name, address: { keys }, invoke: op.invoke };
      return [{ kind: 'leaf', description: op.description, step }];
    }
    if (op.choices.length === 0) return [];
    const children = op.choices.map(
      ({ label, invoke }, choice): StepTree => ({
        kind: 'leaf',
        description: label,
        step: { name: `${name}(${JSON.stringify(label)})`, address: { keys, choice }, invoke },
      }),
    );
    const address = { keys };
    return [
      { kind: 'node', description: op.description, address, strategy: op.strategy, children },
    ];
  });

/**
 * Where a pick stands: the action chosen so far, the trees still to choose among, how to ask them
 * when they don't fit one question, and, inside a group, the level to go back to: the one above,
 * without this group. It is built only when the group is entered: built for every closed group of
 * a question, it would copy the level's trees once per group.
 */
type Level = {
  trail: readonly string[];
  trees: readonly StepTree[];
  strategy?: ListStrategy;
  back?: () => Level;
};

/** Offered last inside a group, so a wrong group costs one more question instead of a wrong move. */
const GO_BACK = 'None of these: go back';

/** What the model reads as one option, and what choosing it leads to: a step, or another level. */
type Option =
  | { kind: 'step'; description: string; step: Step }
  | { kind: 'level'; description: string; level: Level; info: OptionInfo };

/** Every `Option` gut makes, so an asked option can be told from one a list strategy made. */
const ownOptions = new WeakSet<object>();

const own = <T extends Option>(option: T): T => {
  ownOptions.add(option);
  return option;
};

const isOwnOption = (option: object): option is Option => ownOptions.has(option);

/** The nearest level above that still has something to choose among. */
const nearestBack = (level: Level | undefined): Level | undefined => {
  if (level === undefined) return undefined;
  if (level.trees.length > 0) return level;
  return nearestBack(level.back?.());
};

/** Going back out of a group, to the nearest level above with anything left to choose. */
const goBackAt = ({ back }: Level): Extract<Option, { kind: 'level' }> | undefined => {
  const ancestor = nearestBack(back?.());
  return ancestor === undefined
    ? undefined
    : own({ kind: 'level', description: GO_BACK, level: ancestor, info: { kind: 'back' } });
};

/** How many of a group's moves its option names before "+N more". */
const PREVIEW_SIZE = 8;

/** One line per group and move, each indented 2 more spaces than its group. */
const formatOutline = (trees: readonly StepTree[], indent = 2): string[] =>
  trees.flatMap(tree => {
    const line = `${' '.repeat(indent)}${tree.description}`;
    if (tree.kind === 'leaf') return [line];
    return [line, ...formatOutline(tree.children, indent + 2)];
  });

/**
 * What a group holds, in its own option only, so the model can tell where to look: the trail and
 * breadcrumbs inside it name the group alone. Its first 8 moves, as an outline under the groups
 * inside it: a move's group names it ("Manchester", "Details") where its own name can't.
 */
const previewOf = (trees: readonly StepTree[]) => {
  const leaves = mapLeaves(trees, leaf => leaf);
  const shown = new Set(leaves.slice(0, PREVIEW_SIZE));
  const more = leaves.length - PREVIEW_SIZE;
  const lines = [
    ...formatOutline(keepLeaves(trees, leaf => shown.has(leaf))),
    ...(more > 0 ? [`  … (+${more} more)`] : []),
  ];
  return `contains:\n${lines.join('\n')}`;
};

type NodeTree = Extract<StepTree, { kind: 'node' }>;

const nodesOf = (trees: readonly StepTree[]): NodeTree[] =>
  trees.filter((tree): tree is NodeTree => tree.kind === 'node');

/** How many options opening a node adds: one per child, in place of its own. */
const costOf = (node: NodeTree) => node.children.length - 1;

/**
 * Opens closed nodes one by one, picking the one whose opening adds the fewest options, as long as
 * the total number of options stays within maxOptions. Ties break by tree order. The candidates are
 * the closed nodes under open ones, in tree order; the total only grows, so a node too big to open
 * now never will be, and is dropped. A loop, not recursion: a page can hold thousands of groups.
 */
const openNodes = (trees: readonly StepTree[], maxOptions: number): ReadonlySet<StepTree> => {
  const opened = new Set<StepTree>();
  let count = trees.length;
  let candidates = nodesOf(trees);
  for (;;) {
    candidates = candidates.filter(node => count + costOf(node) <= maxOptions);
    const best = candidates.reduce<NodeTree | undefined>(
      (min, node) => (min === undefined || costOf(node) < costOf(min) ? node : min),
      undefined,
    );
    if (best === undefined) return opened;
    opened.add(best);
    count += costOf(best);
    candidates = candidates.flatMap(node => (node === best ? nodesOf(best.children) : [node]));
  }
};

/**
 * A level's moves: closed nodes open one by one (fewest options first) within maxOptions. If all
 * leaves fit, everything opens flat; if everything closed exceeds the limit, all are returned closed.
 */
const movesAt = (level: Level, maxOptions: number): Option[] => {
  const opened = openNodes(level.trees, maxOptions);

  const toOptions = (trees: readonly StepTree[], path: readonly NodeTree[] = []): Option[] =>
    trees.flatMap((tree): Option[] => {
      if (tree.kind === 'leaf') {
        const description = [...path.map(node => node.description), tree.description].join(' › ');
        return [own({ kind: 'step', description, step: tree.step })];
      }
      if (opened.has(tree)) {
        return toOptions(tree.children, [...path, tree]);
      }
      const inside: Level = {
        trail: [...level.trail, ...path.map(node => node.description), tree.description],
        trees: tree.children,
        strategy: tree.strategy,
        ...(tree.isGroup === true
          ? { back: () => ({ ...level, trees: pruneTree(level.trees, tree) }) }
          : {}),
      };
      const nodeDescription =
        tree.isGroup === true
          ? `${tree.description} — ${previewOf(tree.children)}`
          : tree.description;
      const description = [...path.map(node => node.description), nodeDescription].join(' › ');
      const moves = mapLeaves(tree.children, leaf => leaf).length;
      const info: OptionInfo =
        tree.isGroup === true
          ? { kind: 'group', address: tree.address, moves }
          : { kind: 'choices', address: tree.address, moves };
      return [own({ kind: 'level', description, level: inside, info })];
    });

  return toOptions(level.trees);
};

/**
 * Whether the goal is met is its own two-way question, asked in the round's first request beside the
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

/** Who answers each turn of a pick: the model, a person, a re-pick, or the budget. */
export type TurnReply =
  | {
      kind: 'answered';
      answers: Record<string, Answer>;
      inputTokens: number;
      isModel: boolean;
    }
  | { kind: 'repick' }
  | { kind: 'budget' };

/** What every request in a run shares. */
export type Asker = {
  answer: (
    request: DecisionRequest,
    usage: Usage,
    optionInfo: OptionInfoByQuestion,
  ) => Promise<TurnReply>;
};

type Ending =
  | { status: 'achieved' }
  | { status: 'halted'; reason: 'budget' }
  | { status: 'repick' };

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

/** What an asked option is: one of gut's own, or a bundle a list strategy made. */
const infoOf = (option: { description: string }): OptionInfo => {
  if (isOwnOption(option)) {
    return option.kind === 'step' ? { kind: 'move', address: option.step.address } : option.info;
  }
  const size = 'items' in option && Array.isArray(option.items) ? option.items.length : undefined;
  return size === undefined || size === 0 ? { kind: 'bundle' } : { kind: 'bundle', size };
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

  /** Sends one request, with the goal question while it is pending. */
  const send = async (
    questions: Record<string, Question>,
    optionInfo: OptionInfoByQuestion = {},
  ) => {
    const request: DecisionRequest = {
      state: context,
      questions: {
        ...(isGoalPending ? { achieved: goalQuestion(context.goal) } : {}),
        ...questions,
      },
    };
    const reply = await asker.answer(request, usage, optionInfo);
    if (reply.kind === 'repick') throw new PickEnded({ status: 'repick' });
    if (reply.kind === 'budget') throw new PickEnded({ status: 'halted', reason: 'budget' });
    usage = {
      inputTokens: usage.inputTokens + reply.inputTokens,
      requests: usage.requests + (reply.isModel ? 1 : 0),
    };
    if (isGoalPending) settleGoal(reply.answers.achieved);
    return reply.answers;
  };

  /**
   * Chooses among 1 to `maxOptions` options in one request; the round's first carries the goal. A
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
    const answers = await send(
      { next: nextQuestion(trail, options) },
      { next: Object.fromEntries(options.map((option, i) => [`o${i + 1}`, infoOf(option)])) },
    );
    // Picks run whatever their probability: no threshold separated right picks from wrong ones, so
    // they are logged for the caller, and stalls and the budget stop a run instead.
    const { option, probability } = chosenOption(options, answers.next);
    probabilities.push(probability);
    return option;
  };

  /** A round with nothing to choose still asks the goal, alone, before its step runs or it halts. */
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
      // ponytail: inside a group, going back chosen in one half still plays the final, which may pick
      // a move instead (askWithGoBack sees only the final answer). Refusals are rare and a wrong move
      // shows next round; thread go-back through here if traces show a refused group's first question.
      return knockoutInPagesOf(Math.ceil(options.length / 2))(options, { ask, maxOptions });
    }
  };
  return { ask, maxOptions };
};

/** Thrown from a level's first question when the model goes back out of the group. */
class WentBack extends Error {}

/**
 * Asks a level's moves by its strategy, with going back offered in the first question only: the
 * strategy's questions are one option shorter to leave it room, and it is never bundled.
 */
const askWithGoBack = (questions: Questions, goBack: Option): Questions => {
  let hasAskedFirst = false;
  const ask: Questions['ask'] = async options => {
    if (hasAskedFirst) return questions.ask(options);
    hasAskedFirst = true;
    const isMove = <T>(option: T | Option): option is T => option !== goBack;
    const chosen = await questions.ask([...options, goBack]);
    if (!isMove(chosen)) throw new WentBack();
    return chosen;
  };
  return { ask, maxOptions: questions.maxOptions - 1 };
};

/** Asks level by level until a step is picked. */
const pickAt = async (session: PickSession, level: Level, maxOptions: number): Promise<Step> => {
  const goBack = goBackAt(level);
  const questions = questionsAt(session, level.trail, maxOptions);
  const strategy = level.strategy ?? ListStrategy.bundle;
  if (goBack === undefined) {
    const moves = movesAt(level, maxOptions);
    return descend(session, await strategy(moves, questions), maxOptions);
  }
  // Pin going back beside the strategy's questions only when that leaves room for a real question
  // (maxOptions - 1 >= 2); otherwise offer it as an ordinary last option among the level's moves,
  // asked by the strategy like any other (it may then be bundled at such tiny limits).
  if (maxOptions - 1 >= 2) {
    const moves = movesAt(level, maxOptions - 1);
    try {
      return descend(session, await strategy(moves, askWithGoBack(questions, goBack)), maxOptions);
    } catch (error) {
      if (!(error instanceof WentBack)) throw error;
      return pickAt(session, goBack.level, maxOptions);
    }
  }
  const moves = [...movesAt(level, maxOptions - 1), goBack];
  return descend(session, await strategy(moves, questions), maxOptions);
};

const descend = async (session: PickSession, option: Option, maxOptions: number): Promise<Step> =>
  option.kind === 'step' ? option.step : pickAt(session, option.level, maxOptions);

/**
 * Picks the round's step among its ops, or finds the goal met when `isGoalAsked`; no ops halts the
 * run, once the goal is asked. Whatever ends the pick, it reports what the pick spent, a failure
 * included.
 */
export const pick = async ({
  asker,
  context,
  ops,
  usage,
  isGoalAsked,
  maxOptions,
  edits = [],
}: {
  asker: Asker;
  context: Context;
  ops: Ops;
  usage: Usage;
  isGoalAsked: boolean;
  maxOptions: number;
  /** What the developer changed of the ops' text, or hid; `context` already carries a context edit. */
  edits?: readonly Edit[];
}): Promise<
  Merge<
    | { status: 'picked'; step: Step; probabilities: number[] }
    | { status: 'achieved'; probabilities: number[] }
    | { status: 'halted'; reason: 'noOptions' | 'budget' }
    | { status: 'repick' }
    | { status: 'failed'; error: unknown },
    { usage: Usage }
  >
> => {
  const trees = editTrees(toStepTrees(ops), edits);
  const session = createPickSession({ asker, context, usage, isGoalAsked });
  try {
    // A page with nothing left to do may be the finish line, so the goal is asked before halting.
    if (trees.length === 0) {
      await session.checkGoal();
      return { status: 'halted', reason: 'noOptions', usage: session.snapshot().usage };
    }
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
