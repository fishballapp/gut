/**
 * Path rules, landmark and heading derivation, and turning aria snapshot into controls.
 */

import { claim } from './keys.ts';
import type { AriaSnapshotNode } from './snapshot.ts';

export type Control = {
  readonly role: string;
  readonly name: string;
  readonly path: readonly string[];
  readonly url?: string;
};

/** An option a select op can choose: its label, and the element or position that selects it. */
export type SelectOption = {
  readonly name: string;
  readonly ref?: string;
  readonly index: number;
};

export type RawCandidate = {
  readonly node: AriaSnapshotNode & { readonly ref: string; readonly name: string };
  readonly path: readonly string[];
  readonly rawUrl?: string;
  readonly comboboxOptions?: readonly SelectOption[];
};

export type CandidateOutput = {
  readonly candidates: readonly RawCandidate[];
  readonly headings: readonly {
    readonly level: number;
    readonly text: string;
    readonly ref?: string;
  }[];
};

export const INTERACTIVE_CLICK_ROLES = new Set([
  'link',
  'button',
  'checkbox',
  'switch',
  'radio',
  'tab',
  'menuitem',
  'option',
]);

export const FILL_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);
const ITEM_ROLES = new Set(['listitem', 'row', 'article']);

export const LANDMARK_NAMES: Readonly<Record<string, string>> = {
  banner: 'Header',
  navigation: 'Navigation',
  main: 'Main content',
  contentinfo: 'Footer',
  complementary: 'Sidebar',
  search: 'Search',
  dialog: 'Dialog',
  alertdialog: 'Dialog',
  form: 'Form',
  tablist: 'Tabs',
};

export const truncate = (str: string, maxLen = 40): string => {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
};

export const findFirstHeading = (node: AriaSnapshotNode): string | undefined => {
  if (node.role === 'heading' && node.name !== undefined && node.name.trim().length > 0) {
    return node.name.trim();
  }
  for (const child of node.children ?? []) {
    if (typeof child !== 'string') {
      const found = findFirstHeading(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const descendants = (node: AriaSnapshotNode): AriaSnapshotNode[] =>
  (node.children ?? [])
    .filter((child): child is AriaSnapshotNode => typeof child !== 'string')
    .flatMap(child => [child, ...descendants(child)]);

/**
 * The longest control name in an item: a story's title, not its "upvote"; a product's "View
 * details for Sauce Labs Backpack", not its "Add to cart".
 */
export const findLongestControlName = (node: AriaSnapshotNode): string | undefined =>
  descendants(node)
    .filter(child => child.role !== undefined && INTERACTIVE_CLICK_ROLES.has(child.role))
    .map(child => child.name?.trim() ?? '')
    .reduce<string | undefined>(
      (longest, name) => (name.length > (longest?.length ?? 0) ? name : longest),
      undefined,
    );

/**
 * An item worth naming holds a few controls: an unnamed one with a single control is named by that
 * control already, and a "row" holding dozens is a page's layout (Hacker News puts its whole story
 * table in one), not an item. An item with an accessible name of its own is named by one control.
 */
const MIN_ITEM_CONTROLS = 2;
const MAX_ITEM_CONTROLS = 12;
const controlRoles = (node: AriaSnapshotNode): string[] =>
  descendants(node).flatMap(child =>
    child.role !== undefined &&
    (INTERACTIVE_CLICK_ROLES.has(child.role) || FILL_ROLES.has(child.role))
      ? [child.role]
      : [],
  );

const isNameableItem = (node: AriaSnapshotNode) => {
  const hasExplicitName = (node.name?.trim().length ?? 0) > 0;
  const controls = controlRoles(node).length;
  const minControls = hasExplicitName ? 1 : MIN_ITEM_CONTROLS;
  return controls >= minControls && controls <= MAX_ITEM_CONTROLS;
};

/**
 * Whether siblings are a list's items: plain boxes whose controls have the same roles in the same order
 * (a shop's product cards: picture, name, "Add to cart").
 */
const isSameShapeList = (siblings: readonly AriaSnapshotNode[]) => {
  if (siblings.length < 2) return false;
  const [first, ...rest] = siblings.map(sibling => controlRoles(sibling).join(','));
  return first !== undefined && first.length > 0 && rest.every(shape => shape === first);
};

export const landmarkLevelName = (
  role: string | undefined,
  name: string | undefined,
): string | undefined => {
  if (role === undefined) return undefined;
  const trimmedName = name?.trim();
  const hasName = trimmedName !== undefined && trimmedName.length > 0;

  if (role === 'region') {
    return hasName ? `Region "${trimmedName}"` : undefined;
  }

  const label = LANDMARK_NAMES[role];
  if (label === undefined) return undefined;

  return hasName ? `${label} "${trimmedName}"` : label;
};

/**
 * The names of a list's items: an item's accessible name, else its first heading, else its longest
 * control name, cut at 40 characters, and numbered when two siblings would share one ("2 hours ago
 * (2)"), since a group is found by its name.
 */
const nameItems = (items: readonly AriaSnapshotNode[]): Map<AriaSnapshotNode, string> => {
  const used = new Set<string>();
  const result = new Map<AriaSnapshotNode, string>();

  for (const item of items) {
    const rawName = (() => {
      const explicitName = item.name?.trim();
      if (explicitName !== undefined && explicitName.length > 0) {
        return explicitName;
      }
      return findFirstHeading(item) ?? findLongestControlName(item);
    })();

    if (rawName === undefined || rawName.length === 0) continue;
    const base = truncate(rawName, 40);
    const unique = claim(base, used, n => `${base} (${n})`);
    result.set(item, unique);
  }

  return result;
};

export const appendPathSegment = (
  currentPath: readonly string[],
  segment: string,
): readonly string[] => {
  if (segment.length === 0) return currentPath;
  const truncated = truncate(segment, 40);
  if (currentPath.length > 0) {
    const last = currentPath[currentPath.length - 1];
    if (last === segment || last === truncated) {
      return currentPath;
    }
  }
  return [...currentPath, segment];
};

export const collectComboboxOptions = (node: AriaSnapshotNode): readonly SelectOption[] => {
  const rawOptions: { name: string; ref?: string; index: number }[] = [];
  let optIndex = 0;

  const findOptions = (curr: AriaSnapshotNode) => {
    for (const child of curr.children ?? []) {
      if (typeof child !== 'string') {
        if (child.role === 'option') {
          const curIndex = optIndex++;
          if (child.disabled !== true) {
            const optName = child.name?.trim() ?? '';
            if (optName.length > 0) {
              rawOptions.push({ name: optName, ref: child.ref, index: curIndex });
            }
          }
        } else if (child.role === 'listbox' || child.role === 'group') {
          findOptions(child);
        }
      }
    }
  };

  findOptions(node);

  return rawOptions;
};

export const collectSnapshot = (roots: readonly AriaSnapshotNode[]): CandidateOutput => {
  const candidates: RawCandidate[] = [];
  const headings: { level: number; text: string; ref?: string }[] = [];

  const visit = (
    nodes: readonly (AriaSnapshotNode | string)[],
    containerPath: readonly string[],
    siblingHeadings: readonly { readonly level: number; readonly name: string }[],
    inSelectOp: boolean,
  ): void => {
    let currentSiblingHeadings = [...siblingHeadings];

    const elementNodes = nodes.filter((c): c is AriaSnapshotNode => typeof c !== 'string');
    const isRepeatedPlainBoxes = isSameShapeList(elementNodes);
    const itemCandidates = elementNodes.filter(node => {
      if (node.role !== undefined && ITEM_ROLES.has(node.role)) {
        return isNameableItem(node);
      }
      return isRepeatedPlainBoxes && isNameableItem(node);
    });
    const itemNames = nameItems(itemCandidates);

    for (const node of elementNodes) {
      let nodeContainerPath = containerPath;

      const itemName = itemNames.get(node);
      if (itemName !== undefined) {
        nodeContainerPath = appendPathSegment(nodeContainerPath, itemName);
      }

      const landmark = landmarkLevelName(node.role, node.name);
      if (landmark !== undefined) {
        nodeContainerPath = appendPathSegment(nodeContainerPath, landmark);
      }

      if (node.role === 'heading' && node.name !== undefined && node.name.trim().length > 0) {
        const headingName = node.name.trim();
        const headingLevel = node.level ?? 1;
        headings.push({ level: headingLevel, text: headingName, ref: node.ref });
        currentSiblingHeadings = currentSiblingHeadings.filter(h => h.level < headingLevel);
        currentSiblingHeadings.push({ level: headingLevel, name: headingName });
      }

      const isCombobox = node.role === 'combobox';
      const comboboxOptions = isCombobox ? collectComboboxOptions(node) : undefined;
      const hasSelectOp = comboboxOptions !== undefined && comboboxOptions.length > 0;

      const trimmedName = node.name?.trim();
      const ref = node.ref;

      if (
        ref !== undefined &&
        trimmedName !== undefined &&
        trimmedName.length > 0 &&
        node.disabled !== true
      ) {
        const role = node.role;
        if (role !== undefined) {
          const isOptionCovered = role === 'option' && inSelectOp;
          if (!isOptionCovered) {
            const isClickRole = INTERACTIVE_CLICK_ROLES.has(role);
            const isFillRole = FILL_ROLES.has(role);
            if (isClickRole || isFillRole) {
              const effectivePath =
                landmark !== undefined
                  ? nodeContainerPath
                  : currentSiblingHeadings.reduce(
                      (p, h) => appendPathSegment(p, h.name),
                      nodeContainerPath,
                    );

              candidates.push({
                node: { ...node, ref, name: trimmedName },
                path: effectivePath,
                rawUrl: node.url,
                ...(comboboxOptions !== undefined ? { comboboxOptions } : {}),
              });
            }
          }
        }
      }

      if (node.children !== undefined && node.children.length > 0) {
        const isLandmark = landmark !== undefined;
        const childContainerPath = isLandmark
          ? nodeContainerPath
          : currentSiblingHeadings.reduce(
              (p, h) => appendPathSegment(p, h.name),
              nodeContainerPath,
            );

        const childSiblingHeadings: { readonly level: number; readonly name: string }[] = [];
        const childInSelectOp = inSelectOp || hasSelectOp;

        visit(node.children, childContainerPath, childSiblingHeadings, childInSelectOp);
      }
    }
  };

  visit(roots, [], [], false);
  return { candidates, headings };
};
