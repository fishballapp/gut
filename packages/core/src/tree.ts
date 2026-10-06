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
