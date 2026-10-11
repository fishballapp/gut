// The developer's edits to one pick (`Edit`, events.ts), applied to what the model reads: the context
// it is sent and the tree a pick walks. What runs never changes: a step keeps its name and its invoke.
import type { Edit, OpAddress } from './events.ts';
import type { StepTree } from './pick.ts';
import type { Context } from './task.ts';

const isSameAddress = (a: OpAddress, b: OpAddress): boolean =>
  a.choice === b.choice &&
  a.keys.length === b.keys.length &&
  a.keys.every((key, i) => key === b.keys[i]);

const addressOf = (tree: StepTree): OpAddress =>
  tree.kind === 'leaf' ? tree.step.address : tree.address;

/** The text an edit puts at `address`: a description for an op or group, a label for a choice. */
const editedText = (address: OpAddress, edits: readonly Edit[]): string | undefined =>
  edits
    .map(edit => {
      if (edit.kind === 'description' && isSameAddress(address, { keys: edit.keys })) {
        return edit.description;
      }
      if (
        edit.kind === 'label' &&
        isSameAddress(address, { keys: edit.keys, choice: edit.choice })
      ) {
        return edit.label;
      }
      return undefined;
    })
    .findLast(text => text !== undefined);

const isHidden = (address: OpAddress, edits: readonly Edit[]): boolean =>
  edits.some(edit => edit.kind === 'hide' && isSameAddress(address, edit.address));

/** The context the model is sent: the last one an edit put in, else the task's. */
export const editContext = (context: Context, edits: readonly Edit[]): Context =>
  edits.findLast(edit => edit.kind === 'context')?.context ?? context;

/**
 * The trees with their edits: new descriptions and labels, hidden moves left out, and a group left
 * with nothing in it dropped, as `toStepTrees` drops an empty one. An edit at an address the trees
 * don't have changes nothing.
 */
export const editTrees = (trees: readonly StepTree[], edits: readonly Edit[]): StepTree[] =>
  trees.flatMap((tree): StepTree[] => {
    const address = addressOf(tree);
    if (isHidden(address, edits)) return [];
    const description = editedText(address, edits) ?? tree.description;
    if (tree.kind === 'leaf') return [{ ...tree, description }];
    const children = editTrees(tree.children, edits);
    return children.length === 0 ? [] : [{ ...tree, description, children }];
  });
