// A round's edits while the developer makes them: the text of each op, group and choice, the moves
// left out, and the context's JSON. The edits a re-pick sends are read from the draft against the
// round as observed, so an edit back to what the task wrote sends nothing.
import {
  type Edit,
  EditSchema,
  type OpAddress,
  type OpChoiceNode,
  type OpTreeNode,
} from '@gut.run/core/inspector';
import type { Round } from '../state/inspector-state.ts';

export type Context = Round['context'];

export type EditDraft = {
  /** The text set for an op, group or choice, by `addressKey`: a description, or a choice's label. */
  texts: Readonly<Record<string, string>>;
  /** Whether a move is left out, by `addressKey`. */
  hidden: Readonly<Record<string, boolean>>;
  /** The context as the text area shows it. */
  context: string;
};

/** A move's path as the op tree shows it: its keys, and a choice's index in brackets. */
export const pathOf = ({ keys, choice }: OpAddress): string =>
  choice === undefined ? keys.join('.') : `${keys.join('.')}[${choice}]`;

/** A key for where a move sits in the op tree, so the draft finds it. */
export const addressKey = ({ keys, choice }: OpAddress): string =>
  JSON.stringify([keys, choice ?? null]);

/** The edits the round was last picked with, which a draft starts from. */
export const roundEdits = (round: Round): readonly Edit[] => round.picks.at(-1)?.edits ?? [];

/** The op tree in order, groups before what they hold. */
export const flattenOps = (nodes: readonly OpTreeNode[]): OpTreeNode[] =>
  nodes.flatMap(node => [
    node,
    ...(node.kind === 'group' || node.kind === 'choices' ? flattenOps(node.children) : []),
  ]);

/** What a node reads as now: a choice's label, else an op's or group's description. */
export const observedTextOf = (node: OpTreeNode): string =>
  node.kind === 'choice' ? node.label : node.description;

/** The draft a round's edits make: what they set, hide and replace, and the context as JSON. */
export const draftOf = (edits: readonly Edit[], context: Context): EditDraft =>
  edits.reduce<EditDraft>(
    (draft, edit) => {
      if (edit.kind === 'context') {
        return { ...draft, context: JSON.stringify(edit.context, null, 2) };
      }
      if (edit.kind === 'hide') {
        return { ...draft, hidden: { ...draft.hidden, [addressKey(edit.address)]: true } };
      }
      const address: OpAddress =
        edit.kind === 'label' ? { keys: edit.keys, choice: edit.choice } : { keys: edit.keys };
      const text = edit.kind === 'label' ? edit.label : edit.description;
      return { ...draft, texts: { ...draft.texts, [addressKey(address)]: text } };
    },
    { texts: {}, hidden: {}, context: JSON.stringify(context, null, 2) },
  );

export const withText = (draft: EditDraft, address: OpAddress, text: string): EditDraft => ({
  ...draft,
  texts: { ...draft.texts, [addressKey(address)]: text },
});

export const withHidden = (draft: EditDraft, address: OpAddress, isHidden: boolean): EditDraft => ({
  ...draft,
  hidden: { ...draft.hidden, [addressKey(address)]: isHidden },
});

export const withContext = (draft: EditDraft, context: string): EditDraft => ({
  ...draft,
  context,
});

/** The context a draft's text reads as, or what is wrong with it, in the words of the schema. */
export const contextOf = (text: string): { context: Context } | { problem: string } => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { problem: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = EditSchema.safeParse({ kind: 'context', context: value });
  if (parsed.success && parsed.data.kind === 'context') return { context: parsed.data.context };
  const issue = parsed.error?.issues[0];
  return {
    problem:
      issue === undefined ? 'Not a valid context' : `${issue.path.join('.')}: ${issue.message}`,
  };
};

/** Why the draft's context cannot be picked with, or undefined when it can. */
export const contextProblemOf = (draft: EditDraft): string | undefined => {
  const parsed = contextOf(draft.context);
  return 'problem' in parsed ? parsed.problem : undefined;
};

const choiceIndexOf = (node: OpChoiceNode): number => {
  const { choice } = node.address;
  if (choice === undefined) throw new Error('a choice without its index in the op tree');
  return choice;
};

/** The edit a node's text makes, when the draft sets a text that differs from what the node reads. */
const textEditOf = (node: OpTreeNode, draft: EditDraft): Edit[] => {
  const text = draft.texts[addressKey(node.address)];
  if (text === undefined || text === observedTextOf(node)) return [];
  if (node.kind === 'choice') {
    return [{ kind: 'label', keys: node.address.keys, choice: choiceIndexOf(node), label: text }];
  }
  return [{ kind: 'description', keys: node.address.keys, description: text }];
};

/**
 * The edits a draft makes to a round as observed: what a re-pick sends. A context that parses but is
 * the task's own sends nothing; one that does not parse sends nothing either, and `contextProblemOf`
 * says why, so the caller can refuse to send.
 */
export const editsOf = (ops: readonly OpTreeNode[], context: Context, draft: EditDraft): Edit[] => {
  const nodeEdits = flattenOps(ops).flatMap((node): Edit[] => [
    ...textEditOf(node, draft),
    ...(draft.hidden[addressKey(node.address)] === true
      ? [{ kind: 'hide' as const, address: node.address }]
      : []),
  ]);
  const parsed = contextOf(draft.context);
  const contextEdits: Edit[] =
    'context' in parsed && JSON.stringify(parsed.context) !== JSON.stringify(context)
      ? [{ kind: 'context', context: parsed.context }]
      : [];
  return [...nodeEdits, ...contextEdits];
};

/** The draft a round's current edits start: the same edits, read back the way `editsOf` writes them. */
export const startDraft = (round: Round): EditDraft => draftOf(roundEdits(round), round.context);
