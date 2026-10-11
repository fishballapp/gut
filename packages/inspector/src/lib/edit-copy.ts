// What the developer changed in a round, in the words to find it in their task's code: one line per
// text set and per move hidden, and the context as a line diff. It reads the same draft a re-pick
// sends, so what is copied is what the model was asked to read.
import type { Edit, OpTreeNode } from '@gut.run/core/inspector';
import {
  addressKey,
  type Context,
  draftOf,
  type EditDraft,
  flattenOps,
  observedTextOf,
  pathOf,
} from './edit-draft.ts';
import { type DiffLine, lineDiff } from './line-diff.ts';

export type CopyBack = {
  /** One line per description or label the edits change, and per move they hide. */
  changes: string[];
  /** The context's line diff, or undefined when the edits leave the context as the task wrote it. */
  context: DiffLine[] | undefined;
};

export const MARK = { same: ' ', removed: '-', added: '+' } as const;

const changesOf = (node: OpTreeNode, draft: EditDraft): string[] => {
  const key = addressKey(node.address);
  const text = draft.texts[key];
  const observed = observedTextOf(node);
  const path = pathOf(node.address);
  const textLines =
    text === undefined || text === observed
      ? []
      : [`${path}: ${JSON.stringify(observed)} → ${JSON.stringify(text)}`];
  const hideLines = draft.hidden[key] === true ? [`hide ${path}`] : [];
  return [...textLines, ...hideLines];
};

/** The copy-back of a round's edits, against the round as the task observed it. */
export const copyBackOf = (
  ops: readonly OpTreeNode[],
  context: Context,
  edits: readonly Edit[],
): CopyBack => {
  const draft = draftOf(edits, context);
  const contextDiff = lineDiff(JSON.stringify(context, null, 2), draft.context);
  return {
    changes: flattenOps(ops).flatMap(node => changesOf(node, draft)),
    context: contextDiff.every(line => line.kind === 'same') ? undefined : contextDiff,
  };
};

/** The copy-back as plain text: the changes, then the context's diff under a heading. */
export const copyTextOf = ({ changes, context }: CopyBack): string =>
  [
    ...changes,
    ...(context === undefined
      ? []
      : ['context:', ...context.map(line => `${MARK[line.kind]} ${line.text}`)]),
  ].join('\n');
