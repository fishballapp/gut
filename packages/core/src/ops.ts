// The moves a tick offers, as the task wrote them: ops, and groups of ops. How they are shown to
// the decision model is pick.ts's strategy, not part of this data.
import type { ListStrategy } from './list-strategy.ts';
import type { Tree } from './tree.ts';

type OpSpec = { id: string; description: string };

/** One value an op may run with, by the label the model reads. */
type Choice = { label: string; invoke: () => unknown };

export type Op = Tree<
  OpSpec &
    (
      | { invoke: () => unknown; choices?: undefined }
      | { choices: readonly Choice[]; strategy?: ListStrategy; invoke?: undefined }
    ),
  OpSpec
>;

/** What a tick's `ops` may hold: falsy entries are skipped, so `cond && op(…)` is a conditional op. */
export type OpEntry = Op | false | null | undefined;

export const isOp = (entry: OpEntry) => entry !== false && entry !== null && entry !== undefined;

/** How an op's choices are asked when they don't fit one question; `ListStrategy.bundle` if unset. */
type StrategySpec = { strategy?: ListStrategy };

export function op(
  spec: OpSpec & StrategySpec & { choices: readonly string[]; invoke: (choice: string) => unknown },
): Op;
export function op<T>(
  spec: OpSpec &
    StrategySpec & { choices: Readonly<Record<string, T>>; invoke: (choice: T) => unknown },
): Op;
export function op(spec: OpSpec & { invoke: () => unknown }): Op;
export function op<T>({
  id,
  description,
  choices,
  strategy,
  invoke,
}: OpSpec &
  StrategySpec &
  (
    | { choices?: undefined; invoke: () => unknown }
    | { choices: readonly T[] | Readonly<Record<string, T>>; invoke: (choice: T) => unknown }
  )): Op {
  if (choices === undefined) {
    return { kind: 'leaf', id, description, invoke: () => invoke() };
  }
  const entries: [string, T][] = Array.isArray(choices)
    ? choices.map((value: T) => [String(value), value])
    : Object.entries(choices);
  return {
    kind: 'leaf',
    id,
    description,
    choices: entries.map(([label, value]) => ({ label, invoke: () => invoke(value) })),
    strategy,
  };
}

export const group = ({ id, description }: OpSpec, ops: readonly OpEntry[]): Op => ({
  kind: 'node',
  id,
  description,
  children: ops.filter(isOp),
});
