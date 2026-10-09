// A tree whose leaves and nodes carry their own data, and the walks gut needs over one.

export type Tree<Leaf extends object, Node extends object> =
  | ({ kind: 'leaf' } & Leaf)
  | ({ kind: 'node'; children: readonly Tree<Leaf, Node>[] } & Node);

/** Maps every leaf, in order, with the nodes on the way to it from the top. */
export const mapLeaves = <Leaf extends object, Node extends object, Result>(
  trees: readonly Tree<Leaf, Node>[],
  map: (leaf: Leaf, path: readonly Node[]) => Result,
  path: readonly Node[] = [],
): Result[] =>
  trees.flatMap(tree => {
    if (tree.kind === 'leaf') return [map(tree, path)];
    return mapLeaves(tree.children, map, [...path, tree]);
  });

/** The forest with only the leaves `keep` accepts; parents left with no children drop out. */
export const keepLeaves = <Leaf extends object, Node extends object>(
  trees: readonly Tree<Leaf, Node>[],
  keep: (leaf: Leaf) => boolean,
): Tree<Leaf, Node>[] =>
  trees.flatMap((tree): Tree<Leaf, Node>[] => {
    if (tree.kind === 'leaf') return keep(tree) ? [tree] : [];
    const children = keepLeaves(tree.children, keep);
    return children.length === 0 ? [] : [{ ...tree, children }];
  });

/** Removes a tree from a forest; parents left with no children drop out too. */
export const pruneTree = <Leaf extends object, Node extends object>(
  trees: readonly Tree<Leaf, Node>[],
  target: Tree<Leaf, Node>,
): Tree<Leaf, Node>[] =>
  trees.flatMap((tree): Tree<Leaf, Node>[] => {
    if (tree === target) return [];
    if (tree.kind === 'leaf') return [tree];
    const children = pruneTree(tree.children, target);
    if (children.length === 0) return [];
    return [{ ...tree, children }];
  });
